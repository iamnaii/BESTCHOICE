import { Prisma } from '@prisma/client';
import { FinanceToolsService } from './finance-tools.service';

/**
 * The LIFF chatbot late-fee quote MUST match what the collection path actually
 * charges (payments.service.recordPayment): flat bracket — tier1 for 1..(min-1)
 * days, tier2 for >= min days. Previously finance-tools quoted a per-day rate
 * which over-stated the fine (e.g. 3,000 quoted vs 100 charged).
 */
describe('FinanceToolsService — bracket late-fee quote', () => {
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
      // default: no config rows → defaults tier1=50, tier2=100, tier2MinDays=3
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

  // ─── new bracket tests (Task 4 RED → GREEN) ───────────────────

  it('getCurrentBalance late fee matches the bracket charged (5 days → 100, not per-day)', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 5 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(100); // 5 days >= tier2MinDays(3) → tier2 = 100
  });

  it('calculateFine explanation describes brackets, not per-day×days', async () => {
    const res = await service.calculateFine(5);
    expect(res.totalFine).toBe(100);
    expect(res.explanation).toContain('100');
    expect(res.explanation).not.toContain('ต่อวัน');
    expect(res.explanation).not.toContain('/วัน');
  });

  // ─── getCurrentBalance tests ───────────────────────────────────

  it('getCurrentBalance: 2000฿ / 60 days → lateFee = tier2 = 100 (flat bracket)', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 60 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(100); // 60 days >= tier2MinDays(3) → tier2 = 100
    expect(res.totalAmount).toBe(2100); // remainingBase 2000 + 100
    expect(res.daysOverdue).toBe(60);
  });

  it('getCurrentBalance: 1 day overdue → tier1 = 50', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 1 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(50); // 1 day < tier2MinDays(3) → tier1 = 50
  });

  it('getCurrentBalance: honors lateFeeWaived → lateFee 0', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 60, lateFeeWaived: true }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(0);
  });

  it('getCurrentBalance: uses the configured tier1 amount when set', async () => {
    prisma.systemConfig.findUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key === 'late_fee_tier1_amount' ? { value: '75' } : null),
    );
    // 1 day → tier1 = 75 (configured)
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 5000, daysOverdue: 1 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(75);
  });

  it('getCurrentBalance: found=false when no active contract', async () => {
    prisma.contract.findMany.mockResolvedValue([]);
    const res = await service.getCurrentBalance('cust-1');
    expect(res.found).toBe(false);
  });

  // ─── calculateFine tests ───────────────────────────────────────

  it('calculateFine(60): >= tier2MinDays days → tier2 = 100', async () => {
    const res = await service.calculateFine(60);
    expect(res.totalFine).toBe(100); // 60 days >= 3 → tier2 = 100
    // no ratePerDay field in new bracket model
    expect((res as Record<string, unknown>).ratePerDay).toBeUndefined();
    expect(res.explanation).not.toContain('5%');
    expect(res.explanation).toContain('100');
  });

  it('calculateFine(2): < tier2MinDays → tier1 = 50', async () => {
    const res = await service.calculateFine(2);
    expect(res.totalFine).toBe(50); // 2 days < 3 → tier1 = 50
  });

  it('calculateFine(0): no fine', async () => {
    const res = await service.calculateFine(0);
    expect(res.totalFine).toBe(0);
  });

  it('calculateFine explanation does not contain บาท/วัน or /วัน', async () => {
    const res = await service.calculateFine(10);
    expect(res.explanation).not.toContain('บาท/วัน');
    expect(res.explanation).not.toContain('/วัน');
  });
});
