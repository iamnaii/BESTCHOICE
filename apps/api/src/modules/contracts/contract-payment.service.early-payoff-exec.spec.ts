import { Prisma } from '@prisma/client';
import { ContractPaymentService } from './contract-payment.service';
import { EarlyPayoffDto } from './dto/contract.dto';

/**
 * Characterization (golden) test for the EXECUTION (money-POSTING) path of
 * ContractPaymentService.earlyPayoff() — the WRITE side that complements the
 * read-only getEarlyPayoffQuote spec (contract-payment.service.early-payoff.spec.ts).
 *
 * earlyPayoff():
 *   1. re-fetches the quote (shares all the math with the preview),
 *   2. opens a Serializable $transaction,
 *   3. FIFO-distributes quote.totalPayoff across every unpaid Payment row,
 *      marking each one PAID,
 *   4. posts ONE aggregated JE via journalAutoService.createAndPost using the
 *      8 documented FINANCE account codes (the JP4 shape),
 *   5. flips the contract to EARLY_PAYOFF + creditBalance 0, then releases
 *      product ownership via productsService.transferOwnership(productId, null).
 *
 * Pure mock-based unit test — the service is constructed directly with plain
 * mock deps (same positional-constructor style as the sibling quote spec). The
 * $transaction mock routes the callback to a tx mock, createAndPost is a jest
 * spy that CAPTURES the JE lines, and transferOwnership is a spy. No real DB.
 *
 * Money is Prisma.Decimal — every value is compared via .toString()/.toFixed(2).
 *
 * ── Concrete scenario (same self-consistent FINANCE contract as the quote) ───
 *   totalMonths      = 12
 *   sellingPrice     = 20000, downPayment = 2000  → true principal = 18000
 *   financedAmount   = 18000 (ยอดจัด base for JE gross)
 *   storeCommission  = 1800
 *   interestTotal    = 1800  (flat)
 *   vatAmount        = 1512
 *   monthlyPayment   = 1926  (incl VAT)
 *   creditBalance    = 0, vatPct = 0.07
 *   6 installments PAID → 6 unpaid (installmentNo 7..12)
 *   discountPct      = default (50 → fraction 0.5)
 *
 * EXPECTED JE values (computed from the actual code, lines 332-368):
 *   epRemainingGross            = (21600/12 ROUND_DOWN = 1800.00) × 6 = 10800.00
 *   epRemainingDeferredInterest = (1800/12 ROUND_HALF_UP = 150.00) × 6 = 900.00
 *   epRemainingDeferredVat      = (1512/12 ROUND_HALF_UP = 126.00) × 6 = 756.00
 *   quote.discountPct           = 50 (percentage form)
 *   epDiscount                  = 900 × 50 / 100 = 450.00   (.div(100) path)
 *   epSettlement (cash debit)   = 10800 − 450 + 756 = 11106.00
 *
 * EXPECTED FIFO distribution of quote.totalPayoff = 11106.00 across 6 unpaid
 *   rows each owing amountDue 1926, lateFee 0, amountPaid 0:
 *     inst 7..11 → 1926.00 each (5 × 1926 = 9630.00)
 *     inst 12    → 11106 − 9630 = 1476.00
 *   all 6 rows end status PAID.
 */
describe('ContractPaymentService.earlyPayoff (EXECUTION / money-posting golden)', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  // ── Contract fixture for findOne()/getEarlyPayoffQuote (read path) ──────────
  const quoteContract = {
    id: 'contract-ep-exec-1',
    status: 'ACTIVE',
    deletedAt: null,
    productId: 'product-ep-1',
    totalMonths: 12,
    monthlyPayment: dec('1926.00'),
    creditBalance: dec('0'),
    vatPct: dec('0.07'),
    sellingPrice: dec('20000'),
    downPayment: dec('2000'),
    storeCommission: dec('1800'),
    financedAmount: dec('18000'),
    interestTotal: dec('1800'),
    vatAmount: dec('1512.00'),
    payments: [
      ...Array.from({ length: 6 }, (_, i) => ({
        installmentNo: i + 1,
        status: 'PAID',
        amountPaid: dec('1926.00'),
        amountDue: dec('1926.00'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        installmentNo: i + 7,
        status: 'PENDING',
        amountPaid: dec('0'),
        amountDue: dec('1926.00'),
        lateFee: dec('0'),
        lateFeeWaived: false,
      })),
    ],
  };

  const installmentSchedules = Array.from({ length: 12 }, (_, i) => ({
    installmentNo: i + 1,
  }));

  // ── Fresh contract row inside the tx (the SELECT-narrowed version) ──────────
  const freshContract = {
    status: 'ACTIVE',
    contractNumber: 'CT-EP-EXEC-001',
    branchId: 'branch-1',
  };

  // ── Unpaid Payment rows that the tx.payment.findMany returns (FIFO order) ───
  const makeUnpaidRows = () =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `pay-${i + 7}`,
      installmentNo: i + 7,
      status: 'PENDING',
      amountDue: dec('1926.00'),
      amountPaid: dec('0'),
      monthlyPrincipal: dec('1500'),
      monthlyInterest: dec('150'),
      monthlyCommission: dec('150'),
      vatAmount: dec('126'),
      lateFee: dec('0'),
      lateFeeWaived: false,
      evidenceUrl: null,
      gatewayRef: null,
    }));

  // epContract row returned by tx.contract.findUniqueOrThrow (drives JE math)
  const epContractRow = {
    id: quoteContract.id,
    totalMonths: 12,
    financedAmount: dec('18000'),
    storeCommission: dec('1800'),
    interestTotal: dec('1800'),
    vatAmount: dec('1512.00'),
  };

  type CapturedLine = { accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal; description?: string };
  type CapturedJe = {
    description: string;
    reference: string;
    metadata: Record<string, unknown>;
    lines: CapturedLine[];
  };

  let prisma: any;
  let tx: any;
  let createAndPost: jest.Mock;
  let transferOwnership: jest.Mock;
  let paymentUpdates: Array<{ where: { id: string }; data: any }>;
  let contractUpdateData: any;
  let service: ContractPaymentService;

  const baseDto: EarlyPayoffDto = {
    paymentMethod: 'CASH',
  };

  const buildService = (contractOverride?: Partial<typeof quoteContract>) => {
    const contract = { ...quoteContract, ...contractOverride };

    paymentUpdates = [];
    contractUpdateData = undefined;

    createAndPost = jest.fn().mockResolvedValue({ id: 'je-ep-1', entryNumber: 'JE-EP-0001' });
    transferOwnership = jest.fn().mockResolvedValue(undefined);

    // tx mock used inside $transaction
    tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(freshContract),
        findUniqueOrThrow: jest.fn().mockResolvedValue(epContractRow),
        update: jest.fn().mockImplementation(({ data }: { data: any }) => {
          contractUpdateData = data;
          return Promise.resolve({ productId: contract.productId ?? null });
        }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue(makeUnpaidRows()),
        update: jest.fn().mockImplementation((args: { where: { id: string }; data: any }) => {
          paymentUpdates.push(args);
          return Promise.resolve({ id: args.where.id, ...args.data });
        }),
      },
    };

    prisma = {
      // findOne() (read path) + getEarlyPayoffQuote()
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      installmentSchedule: { findMany: jest.fn().mockResolvedValue(installmentSchedules) },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
      // resolveFinanceCompanyId + resolveShopCompanyId
      companyInfo: {
        findFirst: jest.fn().mockImplementation((args: { where: { companyCode: string } }) => {
          if (args.where.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE' });
          if (args.where.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP' });
          return Promise.resolve(null);
        }),
      },
      // validatePeriodOpen — no lock configured
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: (t: any) => Promise<unknown>) => cb(tx)),
    };

    service = new ContractPaymentService(
      prisma as any,
      { transferOwnership } as any,
      { createAndPost } as any,
      {} as any, // EarlyPayoffJP4Template never invoked by earlyPayoff()
      {} as any, // ShopCollectSettlementTemplate never invoked
      { generateReceipt: async () => undefined } as any, // ReceiptsService (EARLY_PAYOFF receipt)
    );
    return service;
  };

  const getCapturedJe = (): CapturedJe => createAndPost.mock.calls[0][0] as CapturedJe;
  const lineFor = (je: CapturedJe, code: string) => je.lines.find((l) => l.accountCode === code);

  beforeEach(() => {
    buildService();
  });

  // (a) FIFO marks each unpaid Payment PAID ──────────────────────────────────
  it('(a) FIFO-distributes the payoff and marks every unpaid Payment PAID', async () => {
    await service.earlyPayoff(quoteContract.id, 'user-1', baseDto);

    // One update per unpaid row, in installmentNo order (pay-7 .. pay-12).
    expect(paymentUpdates).toHaveLength(6);
    expect(paymentUpdates.map((u) => u.where.id)).toEqual([
      'pay-7', 'pay-8', 'pay-9', 'pay-10', 'pay-11', 'pay-12',
    ]);

    // Every row flips to PAID with the CASH method + the early-payoff note.
    for (const u of paymentUpdates) {
      expect(u.data.status).toBe('PAID');
      expect(u.data.paymentMethod).toBe('CASH');
      expect(u.data.recordedById).toBe('user-1');
      expect(u.data.notes).toBe('[ปิดก่อนกำหนด]');
    }

    // FIFO amounts: 11106 across six 1926-owed rows → 5×1926 then the 1476 stub.
    const amounts = paymentUpdates.map((u) => (u.data.amountPaid as Prisma.Decimal).toFixed(2));
    expect(amounts).toEqual([
      '1926.00', '1926.00', '1926.00', '1926.00', '1926.00', '1476.00',
    ]);
    // The six FIFO allocations sum exactly to quote.totalPayoff (11106.00).
    const sum = amounts.reduce((s, a) => s.plus(a), new Prisma.Decimal(0));
    expect(sum.toFixed(2)).toBe('11106.00');
  });

  // (b) the createAndPost JE has the 8 documented codes and is BALANCED ───────
  it('(b) posts ONE JE with the 8 documented account codes and Dr === Cr', async () => {
    await service.earlyPayoff(quoteContract.id, 'user-1', baseDto);

    expect(createAndPost).toHaveBeenCalledTimes(1);
    const je = getCapturedJe();

    // The 8 documented FINANCE codes (JP4 spec §6.4), in order.
    expect(je.lines.map((l) => l.accountCode)).toEqual([
      '11-1201', // deposit — KBank default (owner rule 2026-07-08: direct receipt = KBank only)
      '11-2106', // reverse unearned interest
      '21-2102', // clear deferred output VAT
      '52-1106', // early-payoff interest discount
      '11-2101', // clear HP receivable gross
      '11-2105', // clear VAT receivable
      '41-1101', // recognise interest income
      '21-2101', // VAT output settled (ภ.พ.30)
    ]);

    // BALANCED: sum(dr) === sum(cr).
    const totalDr = je.lines.reduce((s, l) => s.plus(l.dr), new Prisma.Decimal(0));
    const totalCr = je.lines.reduce((s, l) => s.plus(l.cr), new Prisma.Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Pin the exact computed per-line amounts (golden).
    expect(lineFor(je, '11-1201')!.dr.toFixed(2)).toBe('11106.00'); // epSettlement
    expect(lineFor(je, '11-2106')!.dr.toFixed(2)).toBe('900.00'); // remaining deferred interest
    expect(lineFor(je, '21-2102')!.dr.toFixed(2)).toBe('756.00'); // remaining deferred VAT
    expect(lineFor(je, '52-1106')!.dr.toFixed(2)).toBe('450.00'); // discount
    expect(lineFor(je, '11-2101')!.cr.toFixed(2)).toBe('10800.00'); // remaining gross
    expect(lineFor(je, '11-2105')!.cr.toFixed(2)).toBe('756.00');
    expect(lineFor(je, '41-1101')!.cr.toFixed(2)).toBe('900.00');
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('756.00');

    // Totals: Dr = 11106 + 900 + 756 + 450 = 13212 ; Cr = 10800 + 756 + 900 + 756 = 13212.
    expect(totalDr.toFixed(2)).toBe('13212.00');

    // Metadata stamps the JP4 tag + the percentage discount + the discount amount.
    expect(je.metadata.tag).toBe('JP4');
    expect(je.metadata.flow).toBe('early-payoff');
    expect(je.metadata.discount).toBe('450.00');
    expect(je.metadata.interestDiscountPercent).toBe(50);
    expect(je.reference).toBe(`${quoteContract.id}:early-payoff`);
  });

  // (c) discount uses .div(100) and matches the quote preview's 52-1106 line ──
  it('(c) discount = .div(100) path and equals the quote preview 52-1106 for the same discountPct', async () => {
    // Quote preview (read path) — feed the SAME chartOfAccount mock so names resolve.
    const quote = await service.getEarlyPayoffQuote(quoteContract.id);
    const previewDiscount = quote.journalPreview.lines.find((l) => l.accountCode === '52-1106')!.debit;
    expect(previewDiscount).toBe('450.00');
    expect(quote.discountPct).toBe(50); // percentage form returned to callers

    // Exec path JE discount (uses quote.discountPct=50 then .div(100)).
    await service.earlyPayoff(quoteContract.id, 'user-1', baseDto);
    const je = getCapturedJe();
    const execDiscount = lineFor(je, '52-1106')!.dr.toFixed(2);

    // The two paths agree to the satang — LOCKED so they cannot drift by 100×.
    expect(execDiscount).toBe('450.00');
    expect(execDiscount).toBe(previewDiscount);
    // If the .div(100) were ever dropped, this would become 22500.00 (50× the
    // fraction-based preview) — that regression would fail this assertion.
  });

  // (d) contract -> EARLY_PAYOFF + creditBalance 0 + transferOwnership(null) ──
  it('(d) flips contract to EARLY_PAYOFF + creditBalance 0 and releases ownership to null', async () => {
    const result = await service.earlyPayoff(quoteContract.id, 'user-1', baseDto);

    expect(tx.contract.update).toHaveBeenCalledTimes(1);
    expect(contractUpdateData.status).toBe('EARLY_PAYOFF');
    expect(contractUpdateData.creditBalance).toBe(0);

    // FINANCE → null ownership release (customer owns the device on payoff).
    expect(transferOwnership).toHaveBeenCalledTimes(1);
    expect(transferOwnership).toHaveBeenCalledWith('product-ep-1', null, tx);

    // Return shape: quote spread + status + paidDate.
    expect(result.status).toBe('EARLY_PAYOFF');
    expect(result.paidDate).toBeInstanceOf(Date);
    expect(result.totalPayoff).toBe(11106);

    // Serializable isolation level passed to $transaction.
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  // (e) discount = 0 path — PREVIEW and EXEC both omit 52-1106 (CONVERGED) ────
  //
  // Post-unification (computeEarlyPayoffJE): both the preview READ path and the
  // EXEC posting path guard the 52-1106 line, so a zero discount drops the line
  // from BOTH. Previously the EXEC JE pushed all 8 lines unconditionally and
  // carried a no-op `52-1106` dr 0.00 line — that benign divergence is now
  // fixed. 'preview === posted' holds with no exceptions.
  it('(e) discount 0 — PREVIEW and EXEC both omit 52-1106 (7 lines · converged)', async () => {
    // Zero-interest contract: interestTotal 0 → remainingDeferredInterest 0
    // → discount 0. (gross = financed + commission + 0 = 19800; vat 1512.)
    const zeroInterestContract = {
      ...quoteContract,
      interestTotal: dec('0'),
    };
    buildService(zeroInterestContract);
    // epContract row must reflect interestTotal 0 for the JE math.
    tx.contract.findUniqueOrThrow.mockResolvedValue({ ...epContractRow, interestTotal: dec('0') });

    // READ path: the preview DROPS the discount line (7 lines).
    const quote = await service.getEarlyPayoffQuote(quoteContract.id);
    expect(quote.journalPreview.lines.find((l) => l.accountCode === '52-1106')).toBeUndefined();
    expect(quote.journalPreview.lines).toHaveLength(7);

    // WRITE path: the posted JE now ALSO drops the discount line (7 lines).
    await service.earlyPayoff(quoteContract.id, 'user-1', baseDto);
    const je = getCapturedJe();
    expect(je.lines.find((l) => l.accountCode === '52-1106')).toBeUndefined();
    expect(je.lines).toHaveLength(7);

    // Preview and posting now carry the SAME codes in the SAME order.
    expect(je.lines.map((l) => l.accountCode)).toEqual(
      quote.journalPreview.lines.map((l) => l.accountCode),
    );

    // Still balanced.
    const totalDr = je.lines.reduce((s, l) => s.plus(l.dr), new Prisma.Decimal(0));
    const totalCr = je.lines.reduce((s, l) => s.plus(l.cr), new Prisma.Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    // No interest deferred → 11-2106 / 41-1101 are 0.00.
    expect(lineFor(je, '11-2106')!.dr.toFixed(2)).toBe('0.00');
    expect(lineFor(je, '41-1101')!.cr.toFixed(2)).toBe('0.00');
    expect(je.metadata.discount).toBe('0.00');
  });

  // (f) the 50% clamp ────────────────────────────────────────────────────────
  it('(f) clamps discountPct to a max of 50% even when the caller asks for more', async () => {
    // dto.discountPct = 80 → getEarlyPayoffQuote clamps to min(50, 80) = 50,
    // returns discountPct 50 → exec JE discount = 900 × 50/100 = 450.00.
    await service.earlyPayoff(quoteContract.id, 'user-1', { paymentMethod: 'CASH', discountPct: 80 });
    const je = getCapturedJe();
    expect(je.metadata.interestDiscountPercent).toBe(50);
    expect(lineFor(je, '52-1106')!.dr.toFixed(2)).toBe('450.00');
    expect(je.metadata.discount).toBe('450.00');
  });

  it('(f2) clamps a negative discountPct up to 0% — EXEC JE omits 52-1106 (7 lines)', async () => {
    // Math.max(0, Math.min(50, -10)) = 0 → quote discountPct 0 → discount
    // = 900 × 0/100 = 0. The EXEC JE now guards the 52-1106 line (converged
    // with the preview — see (e)).
    await service.earlyPayoff(quoteContract.id, 'user-1', { paymentMethod: 'CASH', discountPct: -10 });
    const je = getCapturedJe();
    expect(je.metadata.interestDiscountPercent).toBe(0);
    expect(je.lines.find((l) => l.accountCode === '52-1106')).toBeUndefined();
    expect(je.lines).toHaveLength(7);
  });

  // ── CHARACTERIZATION of the documented quote-vs-JE cash divergence ─────────
  // ACCOUNTANT NOTE (contract-payment.service.ts ~lines 361-367): the JE cash
  // debit (epSettlement) is built from the per-installment deferred-interest
  // breakdown, while the cash the customer is QUOTED (quote.totalPayoff) nets
  // out creditBalance/advance and discounts GROSS PROFIT. The two bases can
  // diverge. In THIS clean fixture they happen to coincide; we pin both so any
  // future divergence surfaces here.
  it('characterizes the quote-cash vs JE-cash bases (coincide in this clean fixture)', async () => {
    const quote = await service.getEarlyPayoffQuote(quoteContract.id);
    const result = await service.earlyPayoff(quoteContract.id, 'user-1', baseDto);
    const je = getCapturedJe();

    const jeCash = lineFor(je, '11-1201')!.dr.toFixed(2);
    // quote.totalPayoff = remainingBalance(11556) − discount(450) + lateFees(0).
    expect(quote.totalPayoff).toBe(11106);
    // FIFO total handed to the Payment rows = quote.totalPayoff.
    const fifoTotal = paymentUpdates
      .reduce((s, u) => s.plus(u.data.amountPaid as Prisma.Decimal), new Prisma.Decimal(0))
      .toFixed(2);
    expect(fifoTotal).toBe('11106.00');
    // JE cash debit (deferred-interest basis).
    expect(jeCash).toBe('11106.00');
    // In this fixture: quote cash === FIFO cash === JE cash. (See bugFound for
    // the documented basis-divergence risk that does NOT manifest here.)
    expect(result.totalPayoff).toBe(11106);
  });

  // Non-cash method without reference/slip is rejected BEFORE the tx opens.
  it('rejects a non-CASH method with no referenceNo and no slipUrl', async () => {
    await expect(
      service.earlyPayoff(quoteContract.id, 'user-1', { paymentMethod: 'BANK_TRANSFER' }),
    ).rejects.toThrow('กรุณาระบุเลขที่อ้างอิงหรือแนบสลิปสำหรับการชำระแบบโอน/QR');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(createAndPost).not.toHaveBeenCalled();
  });
});
