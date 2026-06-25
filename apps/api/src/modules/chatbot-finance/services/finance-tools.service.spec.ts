import { Prisma } from '@prisma/client';
import { FinanceToolsService } from './finance-tools.service';

/**
 * The LIFF chatbot late-fee quote MUST match what the collection path actually
 * charges (payments.service.recordPayment): mode-aware (PER_DAY or BRACKET),
 * config-driven. Default mode = PER_DAY (rate=20/day, max=500, cap=5%).
 *
 * Updated from flat-bracket assertions (100/50) to per-day values in Task 2
 * of feat/late-fee-perday (resolveLateFee dispatcher wired to all TS call sites).
 */
describe('FinanceToolsService — per-day late-fee quote (PER_DAY default)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let service: FinanceToolsService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-08T12:00:00Z'));
    prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ct-1', contractNumber: 'CT-001', product: { model: 'X', color: 'Y' } },
        ]),
      },
      payment: { findFirst: jest.fn() },
      // default: no config rows → defaults mode=PER_DAY, rate=20, max=500, cap=5
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const financeConfig = { bankInfoBlock: 'BANK' } as unknown as ConstructorParameters<
      typeof FinanceToolsService
    >[1];
    service = new FinanceToolsService(prisma, financeConfig);
  });

  afterEach(() => jest.useRealTimers());

  function overdue(opts: { amountDue: number; daysOverdue: number; lateFeeWaived?: boolean }) {
    return {
      installmentNo: 3,
      amountDue: new Prisma.Decimal(opts.amountDue),
      amountPaid: new Prisma.Decimal(0),
      dueDate: new Date(Date.now() - opts.daysOverdue * 86400000),
      lateFeeWaived: opts.lateFeeWaived ?? false,
      status: 'OVERDUE',
    };
  }

  // ─── getCurrentBalance tests ───────────────────────────────────

  it('getCurrentBalance: 5 days overdue, amountDue=2000 → lateFee=100 (5×20=100, min(100,500,5%×2000=100)=100)', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 5 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(100); // 5×20=100, cap=5%×2000=100 → min=100
  });

  it('getCurrentBalance: 60 days overdue, amountDue=2000 → lateFee=100 (5% cap binds)', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 60 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(100); // 60×20=1200, cap=5%×2000=100 → min=100
    expect(res.totalAmount).toBe(2100); // remainingBase 2000 + 100
    expect(res.daysOverdue).toBe(60);
  });

  it('getCurrentBalance: 1 day overdue, amountDue=2000 → lateFee=20 (per-day rate binds)', async () => {
    // Updated from 50 (bracket tier1) to 20 (1 day × 20฿/day) in Task 2.
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 1 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(20); // 1×20=20 < maxAmount 500 < 5%×2000=100 → 20
  });

  it('getCurrentBalance: honors lateFeeWaived → lateFee 0', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 60, lateFeeWaived: true }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(0);
  });

  it('getCurrentBalance: uses the configured per-day rate when set', async () => {
    // Updated from tier1 test (bracket) to per-day rate test.
    // Configured rate=10/day, 1 day, amountDue=5000 → 1×10=10
    prisma.systemConfig.findUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key === 'late_fee_per_day_rate' ? { value: '10' } : null),
    );
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 5000, daysOverdue: 1 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(10); // 1×10=10
  });

  it('getCurrentBalance: found=false when no active contract', async () => {
    prisma.contract.findMany.mockResolvedValue([]);
    const res = await service.getCurrentBalance('cust-1');
    expect(res.found).toBe(false);
  });

  // ─── calculateFine tests ───────────────────────────────────────

  it('calculateFine(5): 5×20=100 (per-day rate wins, cap not binding for no-context estimate)', async () => {
    // Updated from bracket 100 (still 100, but now per-day).
    const res = await service.calculateFine(5);
    expect(res.totalFine).toBe(100); // 5×20=100 ≤ maxAmount=500
  });

  it('calculateFine explanation describes per-day model, contains rate and max', async () => {
    // Updated: PER_DAY explanation now says "บาท/วัน" not bracket ranges.
    const res = await service.calculateFine(5);
    expect(res.totalFine).toBe(100);
    expect(res.explanation).toContain('100');
    expect(res.explanation).toContain('/วัน');
  });

  it('calculateFine(60): 60×20=1200, maxAmount 500 binds → 500', async () => {
    // Updated from 100 (bracket tier2) to 500 (maxAmount ceiling in PER_DAY).
    const res = await service.calculateFine(60);
    expect(res.totalFine).toBe(500); // 60×20=1200 > maxAmount=500 → 500
    // no ratePerDay field directly, but mode is PER_DAY
    expect((res as Record<string, unknown>).ratePerDay).toBeUndefined();
    expect(res.explanation).toContain('500');
  });

  it('calculateFine(2): 2×20=40 (per-day, below maxAmount and cap)', async () => {
    // Updated from 50 (bracket tier1) to 40 (2 days × 20).
    const res = await service.calculateFine(2);
    expect(res.totalFine).toBe(40);
  });

  it('calculateFine(0): no fine', async () => {
    const res = await service.calculateFine(0);
    expect(res.totalFine).toBe(0);
  });

  it('calculateFine explanation contains per-day rate info', async () => {
    // Updated: PER_DAY mode explanation contains "บาท/วัน".
    const res = await service.calculateFine(10);
    expect(res.explanation).toContain('บาท/วัน');
  });
});
