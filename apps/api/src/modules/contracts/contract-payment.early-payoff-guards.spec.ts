import { Prisma } from '@prisma/client';
import { ContractPaymentService } from './contract-payment.service';
import { EarlyPayoffDto } from './dto/contract.dto';

/**
 * Characterization (golden) test — Wave 3 MED gap-fill.
 *
 * Pins the CURRENT behaviour of the early-payoff DECISION GUARDS that the
 * sibling specs (contract-payment.service.early-payoff*.spec.ts and
 * contract-payment.early-payoff-money.spec.ts) leave uncovered:
 *
 *   1. getEarlyPayoffQuote status guard (src lines 78-80) — only ACTIVE /
 *      OVERDUE / DEFAULT contracts may be quoted. COMPLETED throws; OVERDUE
 *      proceeds (it is on the allow-list).
 *   2. getEarlyPayoffQuote totalMonths guard (src lines 81-83) — a contract
 *      with totalMonths 0 (or null) throws BEFORE any installment lookup.
 *   3. getEarlyPayoffQuote remainingMonths Set guard (src lines 91-101) — the
 *      remaining-month count is computed by SUBTRACTING the Set of PAID
 *      Payment.installmentNo from the full installmentSchedule. When every
 *      schedule row is covered by a PAID payment the count is 0 → throws
 *      "ไม่มีงวดค้างชำระ...". (Quirk: the count is driven by the
 *      installmentSchedule rows ∖ PAID-payment Set, NOT by counting PAID rows.)
 *   4. earlyPayoff period-lock back-date guard (src lines 235, 249-251) — a
 *      paidDate that lands inside a CLOSED FINANCE AccountingPeriod is rejected
 *      by validatePeriodOpen, and that rejection happens BEFORE the
 *      $transaction opens, so NO payment.update / createAndPost / contract
 *      mutation ever runs.
 *
 * Pure mock-based unit test — the service is constructed directly with plain
 * positional mock deps (same style as the sibling early-payoff specs). No real
 * DB. Money is Prisma.Decimal where the code does Decimal ops.
 */
describe('ContractPaymentService early-payoff guards (Wave 3 MED gap-fill)', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  // ── Base self-consistent FINANCE contract (mirrors findOne includes; only the
  //    fields the quote/exec paths read). 6 PAID + 6 unpaid by default. ────────
  const baseContract = {
    id: 'contract-ep-guard-1',
    status: 'ACTIVE',
    deletedAt: null,
    productId: 'product-ep-1',
    contractNumber: 'CT-EP-GUARD-001',
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

  // 12 distinct installmentSchedule rows (1..12) — the universe the Set guard
  // subtracts the PAID Payment installmentNos from.
  const allInstallmentSchedules = Array.from({ length: 12 }, (_, i) => ({
    installmentNo: i + 1,
  }));

  type AnyMock = Record<string, unknown>;

  let prisma: AnyMock & {
    contract: { findUnique: jest.Mock };
    installmentSchedule: { findMany: jest.Mock };
    chartOfAccount: { findMany: jest.Mock };
    companyInfo: { findFirst: jest.Mock };
    systemConfig: { findUnique: jest.Mock };
    accountingPeriod: { findUnique: jest.Mock };
    payment: { findMany: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  // tx mock is accessed with nested property reads (tx.payment.update, etc.);
  // typed `any` to mirror the sibling early-payoff-exec spec.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  let createAndPost: jest.Mock;
  let transferOwnership: jest.Mock;
  let service: ContractPaymentService;

  /**
   * Build the service.
   *   contractOverride          → patches the findOne()/quote contract
   *   installmentSchedulesOverride → patches the installmentSchedule.findMany rows
   *   periodStatus              → AccountingPeriod.status returned by validatePeriodOpen
   *                               (undefined = no row → period OPEN, not locked)
   */
  const buildService = (opts?: {
    contractOverride?: Partial<typeof baseContract>;
    installmentSchedulesOverride?: Array<{ installmentNo: number }>;
    periodStatus?: string;
  }) => {
    const contract = { ...baseContract, ...opts?.contractOverride };
    const schedules = opts?.installmentSchedulesOverride ?? allInstallmentSchedules;

    createAndPost = jest.fn().mockResolvedValue({ id: 'je-ep-1', entryNumber: 'JE-EP-0001' });
    transferOwnership = jest.fn().mockResolvedValue(undefined);

    // tx mock — only reached if the period-lock guard PASSES.
    tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          contractNumber: contract.contractNumber,
          branchId: 'branch-1',
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: contract.id,
          totalMonths: contract.totalMonths,
          financedAmount: contract.financedAmount,
          storeCommission: contract.storeCommission,
          interestTotal: contract.interestTotal,
          vatAmount: contract.vatAmount,
        }),
        update: jest.fn().mockResolvedValue({ productId: contract.productId }),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 6 }, (_, i) => ({
            id: `pay-${i + 7}`,
            installmentNo: i + 7,
            status: 'PENDING',
            amountDue: dec('1926.00'),
            amountPaid: dec('0'),
            lateFee: dec('0'),
            lateFeeWaived: false,
            evidenceUrl: null,
            gatewayRef: null,
          })),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    prisma = {
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      installmentSchedule: { findMany: jest.fn().mockResolvedValue(schedules) },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
      companyInfo: {
        findFirst: jest.fn().mockImplementation((args: { where: { companyCode: string } }) => {
          if (args.where.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE' });
          if (args.where.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP' });
          return Promise.resolve(null);
        }),
      },
      // validatePeriodOpen: period_grace_days SystemConfig (null → default 5).
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      // validatePeriodOpen: the AccountingPeriod for (companyId, year, month).
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue(
          opts?.periodStatus ? { status: opts.periodStatus } : null,
        ),
      },
      payment: { findMany: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((cb: (t: AnyMock) => Promise<unknown>) => cb(tx)),
    };

    service = new ContractPaymentService(
      prisma as never,
      { transferOwnership } as never,
      { createAndPost } as never,
      {} as never, // EarlyPayoffJP4Template never invoked
    );
    return service;
  };

  beforeEach(() => {
    buildService();
  });

  // ── (1) getEarlyPayoffQuote status guard (src 78-80) ───────────────────────
  describe('getEarlyPayoffQuote — status guard', () => {
    it('rejects a COMPLETED contract (not on the ACTIVE/OVERDUE/DEFAULT allow-list)', async () => {
      buildService({ contractOverride: { status: 'COMPLETED' } });

      await expect(service.getEarlyPayoffQuote(baseContract.id)).rejects.toThrow(
        'สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT',
      );

      // Throws at the status gate BEFORE the installmentSchedule lookup.
      expect(prisma.installmentSchedule.findMany).not.toHaveBeenCalled();
    });

    it('proceeds for an OVERDUE contract (OVERDUE is on the allow-list)', async () => {
      buildService({ contractOverride: { status: 'OVERDUE' } });

      const quote = await service.getEarlyPayoffQuote(baseContract.id);

      // Reaches the full computation — 6 of 12 installments remain.
      expect(quote.remainingMonths).toBe(6);
      expect(quote.totalPayoff).toBe(11106);
      expect(prisma.installmentSchedule.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // ── (2) getEarlyPayoffQuote totalMonths guard (src 81-83) ──────────────────
  describe('getEarlyPayoffQuote — totalMonths guard', () => {
    it('rejects totalMonths 0 with the exact Thai message and the data-error prefix', async () => {
      buildService({ contractOverride: { totalMonths: 0 } });

      // Source string is the FULL message incl. the "ข้อมูลสัญญาผิดพลาด:" prefix
      // (the prompt abbreviates it to "จำนวนงวดต้องมากกว่า 0" — a substring).
      await expect(service.getEarlyPayoffQuote(baseContract.id)).rejects.toThrow(
        'ข้อมูลสัญญาผิดพลาด: จำนวนงวดต้องมากกว่า 0',
      );
      // The substring the prompt cites is also satisfied.
      await expect(service.getEarlyPayoffQuote(baseContract.id)).rejects.toThrow(
        'จำนวนงวดต้องมากกว่า 0',
      );

      // Throws at the totalMonths gate BEFORE the installmentSchedule lookup.
      expect(prisma.installmentSchedule.findMany).not.toHaveBeenCalled();
    });
  });

  // ── (3) getEarlyPayoffQuote remainingMonths Set guard (src 91-101) ─────────
  describe('getEarlyPayoffQuote — remainingMonths Set guard', () => {
    it('throws when every installmentSchedule row is covered by a PAID payment (remainingMonths 0)', async () => {
      // All 12 payments PAID → the PAID Set = {1..12} covers every one of the
      // 12 installmentSchedule rows → remainingMonths = 12 − 12 = 0.
      const allPaidContract = {
        ...baseContract,
        payments: Array.from({ length: 12 }, (_, i) => ({
          installmentNo: i + 1,
          status: 'PAID',
          amountPaid: dec('1926.00'),
          amountDue: dec('1926.00'),
          lateFee: dec('0'),
          lateFeeWaived: false,
        })),
      };
      buildService({ contractOverride: allPaidContract });

      await expect(service.getEarlyPayoffQuote(baseContract.id)).rejects.toThrow(
        'ไม่มีงวดค้างชำระ ไม่จำเป็นต้องปิดก่อนกำหนด',
      );

      // The Set guard runs AFTER the installmentSchedule lookup (it needs the
      // schedule rows to subtract the PAID Set from).
      expect(prisma.installmentSchedule.findMany).toHaveBeenCalledTimes(1);
    });

    it('QUIRK: count is installmentSchedule ∖ PAID-Set — 5 PAID-but-only-3-scheduled still leaves remaining', async () => {
      // Only 3 installmentSchedule rows exist (1,2,3) but 5 payments are PAID
      // (installmentNo 1..5). The Set guard counts SCHEDULE rows whose
      // installmentNo is NOT in the PAID Set: {1,2,3} ∖ {1,2,3,4,5} = ∅ → 0
      // remaining → throws. This pins the directionality: the universe is the
      // installmentSchedule rows, the Set is the PAID payments. PAID rows beyond
      // the schedule (4,5) do not create negative or extra remaining months.
      const partialScheduleContract = {
        ...baseContract,
        payments: Array.from({ length: 5 }, (_, i) => ({
          installmentNo: i + 1,
          status: 'PAID',
          amountPaid: dec('1926.00'),
          amountDue: dec('1926.00'),
          lateFee: dec('0'),
          lateFeeWaived: false,
        })),
      };
      buildService({
        contractOverride: partialScheduleContract,
        installmentSchedulesOverride: [
          { installmentNo: 1 },
          { installmentNo: 2 },
          { installmentNo: 3 },
        ],
      });

      await expect(service.getEarlyPayoffQuote(baseContract.id)).rejects.toThrow(
        'ไม่มีงวดค้างชำระ ไม่จำเป็นต้องปิดก่อนกำหนด',
      );
    });

    it('QUIRK: a non-PAID status (PARTIALLY_PAID) does NOT enter the PAID Set — schedule row stays "remaining"', async () => {
      // installmentSchedule = {1,2}. Payment 1 PAID, payment 2 PARTIALLY_PAID.
      // PAID Set = {1} only. remaining = {1,2} ∖ {1} = {2} → 1 remaining month,
      // so the quote PROCEEDS (no throw). Pins that only status === 'PAID'
      // removes a schedule row from the remaining count.
      const partialPaidContract = {
        ...baseContract,
        payments: [
          {
            installmentNo: 1,
            status: 'PAID',
            amountPaid: dec('1926.00'),
            amountDue: dec('1926.00'),
            lateFee: dec('0'),
            lateFeeWaived: false,
          },
          {
            installmentNo: 2,
            status: 'PARTIALLY_PAID',
            amountPaid: dec('500.00'),
            amountDue: dec('1926.00'),
            lateFee: dec('0'),
            lateFeeWaived: false,
          },
        ],
      };
      buildService({
        contractOverride: partialPaidContract,
        installmentSchedulesOverride: [{ installmentNo: 1 }, { installmentNo: 2 }],
      });

      const quote = await service.getEarlyPayoffQuote(baseContract.id);
      expect(quote.remainingMonths).toBe(1);
    });
  });

  // ── (4) earlyPayoff period-lock back-date guard (src 235, 249-251) ─────────
  describe('earlyPayoff — period-lock back-date guard', () => {
    // A paidDate inside a CLOSED FINANCE period, well outside the grace window
    // (Jan 2020: graceEnd = 2020-01-31 + 5d = 2020-02-05, long before now).
    const backDatedClosedDto: EarlyPayoffDto = {
      paymentMethod: 'CASH',
      paymentDate: '2020-01-15',
    };

    it('rejects a back-dated payoff into a CLOSED FINANCE period BEFORE any write happens', async () => {
      buildService({ periodStatus: 'CLOSED' });

      await expect(
        service.earlyPayoff(baseContract.id, 'user-1', backDatedClosedDto),
      ).rejects.toThrow('ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว');

      // validatePeriodOpen looked up the (FINANCE-company, 2020, 1) period.
      expect(prisma.accountingPeriod.findUnique).toHaveBeenCalledWith({
        where: { companyId_year_month: { companyId: 'co-FINANCE', year: 2020, month: 1 } },
        select: { status: true },
      });

      // The guard fires BEFORE the $transaction: NOTHING was mutated.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.payment.update).not.toHaveBeenCalled();
      expect(createAndPost).not.toHaveBeenCalled();
      expect(tx.contract.update).not.toHaveBeenCalled();
      expect(transferOwnership).not.toHaveBeenCalled();
    });

    it('rejects a back-dated payoff into a SYNCED FINANCE period too (SYNCED is also a locked status)', async () => {
      buildService({ periodStatus: 'SYNCED' });

      await expect(
        service.earlyPayoff(baseContract.id, 'user-1', backDatedClosedDto),
      ).rejects.toThrow('ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(createAndPost).not.toHaveBeenCalled();
    });

    it('proceeds when the back-dated period is OPEN (no AccountingPeriod row → not locked)', async () => {
      // No periodStatus → accountingPeriod.findUnique resolves null → validatePeriodOpen
      // returns without throwing → the $transaction and the JE posting run.
      buildService();

      await service.earlyPayoff(baseContract.id, 'user-1', backDatedClosedDto);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(createAndPost).toHaveBeenCalledTimes(1);
      expect(transferOwnership).toHaveBeenCalledWith('product-ep-1', null, tx);
    });

    it('QUIRK: a CLOSED period still inside the grace window does NOT lock (grace 5d default)', async () => {
      // Back-date into a CLOSED period whose last calendar day + 5 grace days is
      // still in the FUTURE relative to "now", so validatePeriodOpen lets it
      // through. The CURRENT calendar month satisfies this: graceEnd =
      // lastDayOfThisMonth + 5d, which is necessarily >= now (we cannot be past
      // this month's last day + 5 while still inside the month). The CLOSED
      // status is therefore tolerated and the payoff proceeds.
      buildService({ periodStatus: 'CLOSED' });
      // Build a YYYY-MM-15 string from the CURRENT local month with no
      // toISOString() round-trip (which would TZ-shift a day-1 date into the
      // previous month). Mid-month is safe from any TZ boundary effect.
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const thisMonthDate = `${y}-${m}-15`;

      await service.earlyPayoff(baseContract.id, 'user-1', {
        paymentMethod: 'CASH',
        paymentDate: thisMonthDate,
      });

      // Inside grace → guard passes → the transaction ran.
      // validatePeriodOpen looked up the CURRENT (year, month).
      expect(prisma.accountingPeriod.findUnique).toHaveBeenCalledWith({
        where: {
          companyId_year_month: { companyId: 'co-FINANCE', year: y, month: now.getMonth() + 1 },
        },
        select: { status: true },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(createAndPost).toHaveBeenCalledTimes(1);
    });
  });
});
