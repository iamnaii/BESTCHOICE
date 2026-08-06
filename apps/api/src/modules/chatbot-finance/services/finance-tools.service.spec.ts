import { Prisma } from '@prisma/client';
import { FinanceToolsService } from './finance-tools.service';

/**
 * The LIFF chatbot late-fee quote MUST match what the collection path actually
 * charges (payments.service.recordPayment): flat-bracket, config-driven.
 * Defaults (BUSINESS_RULES): tier1=50, tier2=100, tier2MinDays=3.
 *
 * CPA ยืนยันขั้นบันไดถาวร 2026-08-01 — the config-switchable
 * `late_fee_mode='PER_DAY'` path that this spec previously exercised as the
 * code default was retired; BRACKET is now the only formula.
 */
describe('FinanceToolsService — flat-bracket late-fee quote', () => {
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
      // default: no config rows → BUSINESS_RULES defaults (tier1=50, tier2=100, minDays=3)
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

  it('getCurrentBalance: 5 days overdue, amountDue=2000 → lateFee=100 (tier2, >= minDays 3)', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 5 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(100);
  });

  it('getCurrentBalance: 60 days overdue, amountDue=2000 → lateFee=100 (still flat tier2, does not grow)', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 60 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(100);
    expect(res.totalAmount).toBe(2100); // remainingBase 2000 + 100
    expect(res.daysOverdue).toBe(60);
  });

  it('getCurrentBalance: 1 day overdue, amountDue=2000 → lateFee=50 (tier1, < minDays 3)', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 1 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(50);
  });

  it('getCurrentBalance: honors lateFeeWaived → lateFee 0', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 60, lateFeeWaived: true }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(0);
  });

  it('getCurrentBalance: uses the configured tier1 amount when set', async () => {
    // Configured tier1=30, 1 day overdue (< default minDays 3) → 30
    prisma.systemConfig.findUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key === 'late_fee_tier1_amount' ? { value: '30' } : null),
    );
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 5000, daysOverdue: 1 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(30);
  });

  it('getCurrentBalance: found=false when no active contract', async () => {
    prisma.contract.findMany.mockResolvedValue([]);
    const res = await service.getCurrentBalance('cust-1');
    expect(res.found).toBe(false);
  });

  // ─── calculateFine tests ───────────────────────────────────────

  it('calculateFine(5): tier2 (>= minDays 3) = 100', async () => {
    const res = await service.calculateFine(5);
    expect(res.totalFine).toBe(100);
  });

  it('calculateFine explanation describes the flat-bracket model, contains tier amounts', async () => {
    const res = await service.calculateFine(5);
    expect(res.totalFine).toBe(100);
    expect(res.explanation).toContain('เหมาจ่าย');
    expect(res.explanation).toContain('100');
  });

  it('calculateFine(60): still flat tier2 = 100 (does not grow with days)', async () => {
    const res = await service.calculateFine(60);
    expect(res.totalFine).toBe(100);
    expect(res.explanation).toContain('100');
  });

  it('calculateFine(2): tier1 (< minDays 3) = 50', async () => {
    const res = await service.calculateFine(2);
    expect(res.totalFine).toBe(50);
  });

  it('calculateFine(0): no fine', async () => {
    const res = await service.calculateFine(0);
    expect(res.totalFine).toBe(0);
  });

  it('calculateFine explanation contains the flat-bracket tier description', async () => {
    const res = await service.calculateFine(10);
    expect(res.explanation).toContain('เหมาจ่าย');
  });
});
