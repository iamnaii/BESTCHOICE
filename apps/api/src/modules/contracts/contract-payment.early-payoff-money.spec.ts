import { Prisma } from '@prisma/client';
import { ContractPaymentService } from './contract-payment.service';
import { EarlyPayoffDto } from './dto/contract.dto';

/**
 * Characterization (golden) test for ContractPaymentService EARLY-PAYOFF *money*
 * branches that the pure computeEarlyPayoffJE golden does NOT exercise — i.e.
 * the SERVICE-layer arithmetic in getEarlyPayoffQuote (lines 104-150, 209-221)
 * and the earlyPayoff FIFO distribution loop (lines 286-312).
 *
 * Wave 3 gap-fill (audit HIGH gap). Sibling specs already cover the happy-path
 * quote + the JE-posting path:
 *   - contract-payment.service.early-payoff.spec.ts       (JE preview math)
 *   - contract-payment.service.early-payoff-exec.spec.ts  (FIFO + JE posting)
 *
 * Bands / branches LOCKED here:
 *   getEarlyPayoffQuote:
 *     · LOSS case — remainingCost > remainingExVat ⇒ grossProfit < 0 ⇒
 *       discountAmount === 0 (no extra reduction, no extra charge), and with
 *       vatPct = 0 ⇒ remainingExVat === remainingBalance. totalPayoff carries
 *       NO 52-1106 gross-profit discount.
 *     · unpaidLateFees (146-150, 221) — only non-PAID, non-waived rows count;
 *       a waived row is excluded; the fee is added to totalPayoff with NO 7% VAT.
 *     · creditBalance + PARTIALLY_PAID advance (110-116) — both fold into
 *       advancePayment and drop remainingBalance / totalPayoff by the same amount.
 *   earlyPayoff FIFO loop (286-312):
 *     · owed = (amountDue + lateFee) − amountPaid, lateFee dropped when waived;
 *       payAmount = min(remainingPayoff, max(0, owed)); new amountPaid accrues.
 *     · a row reached AFTER remainingPayoff hits 0 ⇒ payAmount 0.00 but the row
 *       is still flipped to PAID unconditionally (LOCK the unconditional-PAID
 *       quirk — see quirks).
 *
 * Pure mock-based unit test — no real DB. Money is Prisma.Decimal everywhere the
 * code touches Decimal (d()/dAdd()/dSub()/.toDecimalPlaces()); read path and
 * write path use INDEPENDENT prisma mocks so the FIFO rows can be shaped
 * separately from the quote rows.
 */
describe('ContractPaymentService early-payoff money branches (Wave 3 gap-fill)', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  // ───────────────────────────────────────────────────────────────────────────
  // getEarlyPayoffQuote — LOSS case + late-fees + advance (read path only)
  // ───────────────────────────────────────────────────────────────────────────
  describe('getEarlyPayoffQuote — loss / late-fees / advance', () => {
    const installmentSchedules = Array.from({ length: 12 }, (_, i) => ({
      installmentNo: i + 1,
    }));

    const buildQuoteService = (contract: Record<string, unknown>) => {
      const prisma = {
        contract: { findUnique: jest.fn().mockResolvedValue(contract) },
        installmentSchedule: { findMany: jest.fn().mockResolvedValue(installmentSchedules) },
        chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new ContractPaymentService(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any, // ShopCollectSettlementTemplate never invoked
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { generateReceipt: async () => undefined } as any, // ReceiptsService (EARLY_PAYOFF receipt)
      );
      return service;
    };

    // GAP 1 — LOSS case: cost outruns the ex-VAT remaining balance.
    it('GAP1: loss-case (grossProfit<0) → discountAmount 0 and vatPct 0 → remainingExVat === remainingBalance', async () => {
      // 6 PAID (inst 1..6) + 6 PENDING (inst 7..12) → remainingMonths = 6.
      // monthlyPayment 1000, vatPct 0, no creditBalance/partial → advance 0.
      // totalRemaining = 1000 × 6 = 6000 ; remainingBalance = 6000.
      // vatPct = 0 → remainingExVat = remainingBalance = 6000 (no /(1+vat) path).
      // truePrincipal = sellingPrice 50000 − downPayment 0 = 50000.
      // financeCost = 50000 + storeCommission 0 = 50000.
      // remainingCost = round2(50000/12 × 6) = round2(25000) = 25000.
      // grossProfit = 6000 − 25000 = −19000 (< 0) → discountAmount = 0.
      // totalPayoff = max(0, 6000 − 0) = 6000 ; no late fees → stays 6000.
      const lossContract = {
        id: 'contract-loss-1',
        status: 'ACTIVE',
        deletedAt: null,
        totalMonths: 12,
        monthlyPayment: dec('1000'),
        creditBalance: dec('0'),
        vatPct: dec('0'),
        sellingPrice: dec('50000'),
        downPayment: dec('0'),
        storeCommission: dec('0'),
        financedAmount: dec('50000'),
        interestTotal: dec('0'),
        vatAmount: dec('0'),
        payments: [
          ...Array.from({ length: 6 }, (_, i) => ({
            installmentNo: i + 1,
            status: 'PAID',
            amountPaid: dec('1000'),
            amountDue: dec('1000'),
            lateFee: dec('0'),
            lateFeeWaived: false,
          })),
          ...Array.from({ length: 6 }, (_, i) => ({
            installmentNo: i + 7,
            status: 'PENDING',
            amountPaid: dec('0'),
            amountDue: dec('1000'),
            lateFee: dec('0'),
            lateFeeWaived: false,
          })),
        ],
      };

      const service = buildQuoteService(lossContract);
      const quote = await service.getEarlyPayoffQuote(lossContract.id);

      expect(quote.remainingMonths).toBe(6);
      expect(quote.totalRemaining).toBe(6000);
      expect(quote.advancePayment).toBe(0);
      expect(quote.remainingBalance).toBe(6000);
      // vatPct 0 → no /(1+vat) division → remainingExVat === remainingBalance.
      expect(quote.remainingExVat).toBe(6000);
      expect(quote.remainingExVat).toBe(quote.remainingBalance);
      expect(quote.remainingCost).toBe(25000);
      // grossProfit negative, surfaced as the real (negative) value.
      expect(quote.grossProfit).toBe(-19000);
      // LOSS branch: discount is 0 (no reduction, and crucially NO add-back).
      expect(quote.discountAmount).toBe(0);
      // totalPayoff = remainingBalance only (no 52-1106 reduction, no late fees).
      expect(quote.totalPayoff).toBe(6000);
    });

    // GAP 2 — unpaidLateFees: waived excluded, no VAT on the fee.
    it('GAP2: unpaidLateFees counts non-waived non-PAID rows only (200), no 7% VAT, folded into totalPayoff', async () => {
      // Same loss-shaped base so discountAmount = 0 → totalPayoff before fees
      // is exactly remainingBalance, isolating the late-fee delta.
      // Two PENDING rows carry late fees:
      //   inst 7  → lateFee 200, waived false → COUNTED
      //   inst 8  → lateFee 300, waived true  → EXCLUDED
      // unpaidLateFees = 200 (300 dropped). 200 added with NO 7% VAT.
      const lateFeeContract = {
        id: 'contract-latefee-1',
        status: 'OVERDUE',
        deletedAt: null,
        totalMonths: 12,
        monthlyPayment: dec('1000'),
        creditBalance: dec('0'),
        vatPct: dec('0'),
        sellingPrice: dec('50000'),
        downPayment: dec('0'),
        storeCommission: dec('0'),
        financedAmount: dec('50000'),
        interestTotal: dec('0'),
        vatAmount: dec('0'),
        payments: [
          ...Array.from({ length: 6 }, (_, i) => ({
            installmentNo: i + 1,
            status: 'PAID',
            amountPaid: dec('1000'),
            amountDue: dec('1000'),
            lateFee: dec('0'),
            lateFeeWaived: false,
          })),
          {
            installmentNo: 7,
            status: 'PENDING',
            amountPaid: dec('0'),
            amountDue: dec('1000'),
            lateFee: dec('200'),
            lateFeeWaived: false,
          },
          {
            installmentNo: 8,
            status: 'PENDING',
            amountPaid: dec('0'),
            amountDue: dec('1000'),
            lateFee: dec('300'),
            lateFeeWaived: true,
          },
          ...Array.from({ length: 4 }, (_, i) => ({
            installmentNo: i + 9,
            status: 'PENDING',
            amountPaid: dec('0'),
            amountDue: dec('1000'),
            lateFee: dec('0'),
            lateFeeWaived: false,
          })),
        ],
      };

      const service = buildQuoteService(lateFeeContract);
      const quote = await service.getEarlyPayoffQuote(lateFeeContract.id);

      expect(quote.remainingMonths).toBe(6);
      expect(quote.remainingBalance).toBe(6000);
      expect(quote.discountAmount).toBe(0);
      // Only the waived=false row's 200 counts; the waived 300 is excluded.
      expect(quote.unpaidLateFees).toBe(200);
      // totalPayoff = remainingBalance (6000) + unpaidLateFees (200) with NO VAT.
      // If 7% VAT were applied to the fee it would be 6214 — pin 6200 to lock
      // the "ค่าปรับไม่คิด VAT" policy.
      expect(quote.totalPayoff).toBe(6200);
    });

    // GAP 3 — advancePayment = creditBalance + PARTIALLY_PAID amountPaid.
    it('GAP3: creditBalance 500 + PARTIALLY_PAID 300 → advancePayment 800, remainingBalance/totalPayoff drop by 800', async () => {
      // 5 PAID (inst 1..5) + 1 PARTIALLY_PAID (inst 6) + 6 PENDING (inst 7..12).
      // PARTIALLY_PAID is NOT PAID → its installmentNo (6) is NOT in paidInstNos
      // → remainingMonths counts it: 12 schedules − 5 paid = 7 remaining.
      // totalRemaining = 1000 × 7 = 7000.
      // advancePayment = creditBalance 500 + partial amountPaid 300 = 800.
      // remainingBalance = 7000 − 800 = 6200.
      // Loss-shaped cost so discountAmount = 0 → totalPayoff = 6200 (+0 fees).
      const advanceContract = {
        id: 'contract-advance-1',
        status: 'ACTIVE',
        deletedAt: null,
        totalMonths: 12,
        monthlyPayment: dec('1000'),
        creditBalance: dec('500'),
        vatPct: dec('0'),
        sellingPrice: dec('80000'),
        downPayment: dec('0'),
        storeCommission: dec('0'),
        financedAmount: dec('80000'),
        interestTotal: dec('0'),
        vatAmount: dec('0'),
        payments: [
          ...Array.from({ length: 5 }, (_, i) => ({
            installmentNo: i + 1,
            status: 'PAID',
            amountPaid: dec('1000'),
            amountDue: dec('1000'),
            lateFee: dec('0'),
            lateFeeWaived: false,
          })),
          {
            installmentNo: 6,
            status: 'PARTIALLY_PAID',
            amountPaid: dec('300'),
            amountDue: dec('1000'),
            lateFee: dec('0'),
            lateFeeWaived: false,
          },
          ...Array.from({ length: 6 }, (_, i) => ({
            installmentNo: i + 7,
            status: 'PENDING',
            amountPaid: dec('0'),
            amountDue: dec('1000'),
            lateFee: dec('0'),
            lateFeeWaived: false,
          })),
        ],
      };

      const service = buildQuoteService(advanceContract);
      const quote = await service.getEarlyPayoffQuote(advanceContract.id);

      // PARTIALLY_PAID row still counts toward remaining (only PAID excluded).
      expect(quote.remainingMonths).toBe(7);
      expect(quote.totalRemaining).toBe(7000);
      // creditBalance 500 + partial amountPaid 300 = 800.
      expect(quote.advancePayment).toBe(800);
      // remainingBalance = 7000 − 800 = 6200.
      expect(quote.remainingBalance).toBe(6200);
      // financeCost 80000/12 × 7 = round2(46666.666...) = 46666.67 > 6200 ex-VAT
      // → grossProfit < 0 → discountAmount 0 → totalPayoff = 6200 (advance applied).
      expect(quote.grossProfit).toBeLessThan(0);
      expect(quote.discountAmount).toBe(0);
      expect(quote.totalPayoff).toBe(6200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // earlyPayoff FIFO loop (286-312) — owed formula, waived drop, post-zero PAID
  // ───────────────────────────────────────────────────────────────────────────
  describe('earlyPayoff — FIFO distribution loop', () => {
    // Read-path (quote) fixture: the SAME self-consistent contract the exec spec
    // uses → quote.totalPayoff = 11106.00 (6 of 12 installments remaining).
    const quoteContract = {
      id: 'contract-ep-fifo-1',
      status: 'ACTIVE',
      deletedAt: null,
      productId: 'product-fifo-1',
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

    const freshContract = {
      status: 'ACTIVE',
      contractNumber: 'CT-EP-FIFO-001',
      branchId: 'branch-1',
    };

    const epContractRow = {
      id: quoteContract.id,
      totalMonths: 12,
      financedAmount: dec('18000'),
      storeCommission: dec('1800'),
      interestTotal: dec('1800'),
      vatAmount: dec('1512.00'),
    };

    // ── 7 unpaid FIFO rows (INDEPENDENT of the quote rows) ─────────────────────
    // quote.totalPayoff = 11106 is FIFO-distributed across these in order:
    //   inst 7  amountDue 1926, amountPaid 500, lateFee 200 (waived false)
    //           → owed = (1926 + 200) − 500 = 1626 ; pay 1626 ; new paid 2126.00
    //   inst 8  amountDue 1926, amountPaid 0,   lateFee 300 (WAIVED) → lateFee 0
    //           → owed = 1926 ; pay 1926 ; new paid 1926.00
    //   inst 9  amountDue 1926, owed 1926 ; pay 1926
    //   inst 10 amountDue 1926, owed 1926 ; pay 1926
    //   inst 11 amountDue 1926, owed 1926 ; pay 1926
    //   inst 12 amountDue 1926, owed 1926 ; remainingPayoff now 1776 → pay 1776
    //           → remainingPayoff hits 0 ; new paid 1776.00
    //   inst 13 amountDue 1926, owed 1926 ; remainingPayoff 0 → payAmount 0.00
    //           → BUT row still flips to PAID (unconditional-PAID quirk)
    // Σ payAmounts = 1626+1926+1926+1926+1926+1776+0 = 11106 = totalPayoff.
    const makeUnpaidRows = () => [
      {
        id: 'pay-7',
        installmentNo: 7,
        status: 'OVERDUE',
        amountDue: dec('1926.00'),
        amountPaid: dec('500'),
        monthlyPrincipal: dec('1500'),
        monthlyInterest: dec('150'),
        monthlyCommission: dec('150'),
        vatAmount: dec('126'),
        lateFee: dec('200'),
        lateFeeWaived: false,
        evidenceUrl: null,
        gatewayRef: null,
      },
      {
        id: 'pay-8',
        installmentNo: 8,
        status: 'OVERDUE',
        amountDue: dec('1926.00'),
        amountPaid: dec('0'),
        monthlyPrincipal: dec('1500'),
        monthlyInterest: dec('150'),
        monthlyCommission: dec('150'),
        vatAmount: dec('126'),
        lateFee: dec('300'),
        lateFeeWaived: true,
        evidenceUrl: null,
        gatewayRef: null,
      },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `pay-${i + 9}`,
        installmentNo: i + 9,
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
      })),
    ];

    let prisma: {
      contract: { findUnique: jest.Mock };
      installmentSchedule: { findMany: jest.Mock };
      chartOfAccount: { findMany: jest.Mock };
      companyInfo: { findFirst: jest.Mock };
      systemConfig: { findUnique: jest.Mock };
      $transaction: jest.Mock;
    };
    let tx: {
      contract: {
        findUnique: jest.Mock;
        findUniqueOrThrow: jest.Mock;
        update: jest.Mock;
      };
      payment: { findMany: jest.Mock; update: jest.Mock };
    };
    let createAndPost: jest.Mock;
    let transferOwnership: jest.Mock;
    let paymentUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }>;
    let service: ContractPaymentService;

    const baseDto: EarlyPayoffDto = { paymentMethod: 'CASH' };

    beforeEach(() => {
      paymentUpdates = [];
      createAndPost = jest.fn().mockResolvedValue({ id: 'je-fifo-1' });
      transferOwnership = jest.fn().mockResolvedValue(undefined);

      tx = {
        contract: {
          findUnique: jest.fn().mockResolvedValue(freshContract),
          findUniqueOrThrow: jest.fn().mockResolvedValue(epContractRow),
          update: jest.fn().mockResolvedValue({ productId: quoteContract.productId }),
        },
        payment: {
          findMany: jest.fn().mockResolvedValue(makeUnpaidRows()),
          update: jest
            .fn()
            .mockImplementation(
              (args: { where: { id: string }; data: Record<string, unknown> }) => {
                paymentUpdates.push(args);
                return Promise.resolve({ id: args.where.id, ...args.data });
              },
            ),
        },
      };

      prisma = {
        contract: { findUnique: jest.fn().mockResolvedValue(quoteContract) },
        installmentSchedule: { findMany: jest.fn().mockResolvedValue(installmentSchedules) },
        chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
        companyInfo: {
          findFirst: jest.fn().mockImplementation((args: { where: { companyCode: string } }) => {
            if (args.where.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE' });
            if (args.where.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP' });
            return Promise.resolve(null);
          }),
        },
        systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      };

      service = new ContractPaymentService(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { transferOwnership } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { createAndPost } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any, // ShopCollectSettlementTemplate never invoked
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { generateReceipt: async () => undefined } as any, // ReceiptsService (EARLY_PAYOFF receipt)
      );
    });

    const dataOf = (id: string) => paymentUpdates.find((u) => u.where.id === id)!.data;

    // GAP4 — owed formula (amountDue + lateFee − amountPaid) + FIFO allocation.
    it('GAP4: owed = (amountDue + lateFee) − amountPaid; non-waived fee included; payAmount + new amountPaid pinned', async () => {
      await service.earlyPayoff(quoteContract.id, 'user-1', baseDto);

      // All 7 rows updated, in installmentNo order (FIFO).
      expect(paymentUpdates.map((u) => u.where.id)).toEqual([
        'pay-7',
        'pay-8',
        'pay-9',
        'pay-10',
        'pay-11',
        'pay-12',
        'pay-13',
      ]);

      // inst 7: owed = (1926 + 200) − 500 = 1626 ⇒ payAmount 1626 ⇒
      //         new amountPaid = 500 + 1626 = 2126.00.
      const p7 = dataOf('pay-7');
      expect((p7.amountPaid as Prisma.Decimal).toFixed(2)).toBe('2126.00');
      expect(p7.status).toBe('PAID');
    });

    it('GAP4: a WAIVED late fee is dropped from owed (lateFee 300 ignored)', async () => {
      await service.earlyPayoff(quoteContract.id, 'user-1', baseDto);

      // inst 8: lateFeeWaived true ⇒ lateFee treated as 0 ⇒ owed = 1926 − 0 = 1926
      // (the 300 fee does NOT inflate the payment). payAmount 1926 ⇒ paid 1926.00.
      const p8 = dataOf('pay-8');
      expect((p8.amountPaid as Prisma.Decimal).toFixed(2)).toBe('1926.00');
      expect(p8.status).toBe('PAID');
    });

    it('GAP4: the full FIFO allocation sums to quote.totalPayoff (11106.00)', async () => {
      const quote = await service.getEarlyPayoffQuote(quoteContract.id);
      expect(quote.totalPayoff).toBe(11106);

      await service.earlyPayoff(quoteContract.id, 'user-1', baseDto);

      // Per-row payAmount = newAmountPaid − amountPaidBefore.
      const before: Record<string, string> = {
        'pay-7': '500',
        'pay-8': '0',
        'pay-9': '0',
        'pay-10': '0',
        'pay-11': '0',
        'pay-12': '0',
        'pay-13': '0',
      };
      const payAmounts = paymentUpdates.map((u) => {
        const after = u.data.amountPaid as Prisma.Decimal;
        return after.minus(new Prisma.Decimal(before[u.where.id]));
      });
      expect(payAmounts.map((p) => p.toFixed(2))).toEqual([
        '1626.00', // inst 7  (owed 1626)
        '1926.00', // inst 8  (owed 1926, waived fee)
        '1926.00', // inst 9
        '1926.00', // inst 10
        '1926.00', // inst 11
        '1776.00', // inst 12 (remainingPayoff exhausted to 0)
        '0.00', // inst 13 (reached after remainingPayoff hit 0)
      ]);
      const sum = payAmounts.reduce((s, p) => s.plus(p), new Prisma.Decimal(0));
      expect(sum.toFixed(2)).toBe('11106.00');
    });

    // GAP4 — the unconditional-PAID quirk: a row reached after the payoff is
    // exhausted gets payAmount 0.00 yet is STILL flipped to PAID.
    it('GAP4 (quirk): row reached after remainingPayoff hits 0 → payAmount 0.00 but status STILL PAID', async () => {
      await service.earlyPayoff(quoteContract.id, 'user-1', baseDto);

      const p13 = dataOf('pay-13');
      // amountPaid unchanged from 0 (0 + 0 = 0.00) → payAmount was 0.00.
      expect((p13.amountPaid as Prisma.Decimal).toFixed(2)).toBe('0.00');
      // QUIRK: marked PAID unconditionally even though nothing was paid on it.
      expect(p13.status).toBe('PAID');
      expect(p13.paymentMethod).toBe('CASH');
      expect(p13.notes).toBe('[ปิดก่อนกำหนด]');
    });
  });
});
