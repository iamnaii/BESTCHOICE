import { Prisma } from '@prisma/client';
import { FinanceToolsService } from './finance-tools.service';

/**
 * The LIFF chatbot late-fee quote MUST match what the collection path actually
 * charges (payments.service.recordPayment): min(perDay×days, flatCap, amountDue×5%).
 * Previously finance-tools quoted an UNCAPPED daysOverdue×rate, over-stating the
 * fine (e.g. 3,000 quoted vs 100 charged on a 2,000฿ / 60-day installment).
 */
describe('FinanceToolsService — capped late-fee quote', () => {
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
      // default: no config rows → defaults perDay 50, flatCap 1500 (match payments.service)
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

  it('getCurrentBalance: 2000฿ / 60 days → lateFee capped at 5% = 100 (NOT uncapped 3000)', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 60 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(100); // min(50×60=3000, 1500, 2000×0.05=100) = 100
    expect(res.totalAmount).toBe(2100); // remainingBase 2000 + 100
    expect(res.daysOverdue).toBe(60);
  });

  it('getCurrentBalance: honors lateFeeWaived → lateFee 0', async () => {
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 2000, daysOverdue: 60, lateFeeWaived: true }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(0);
  });

  it('getCurrentBalance: uses the configured per-day rate when set', async () => {
    prisma.systemConfig.findUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key === 'late_fee_per_day' ? { value: '100' } : null),
    );
    // 1 day × 100 = 100; 5% of 5000 = 250; flat 1500 → min = 100
    prisma.payment.findFirst.mockResolvedValue(overdue({ amountDue: 5000, daysOverdue: 1 }));
    const res = await service.getCurrentBalance('cust-1');
    expect(res.lateFee).toBe(100);
  });

  it('getCurrentBalance: found=false when no active contract', async () => {
    prisma.contract.findMany.mockResolvedValue([]);
    const res = await service.getCurrentBalance('cust-1');
    expect(res.found).toBe(false);
  });

  it('calculateFine(60): no installment context → bounded by the flat cap (1500), not uncapped 3000; notes the 5% cap', async () => {
    const res = await service.calculateFine(60);
    expect(res.totalFine).toBe(1500); // min(50×60, 1500) — no amountDue so no % cap
    expect(res.ratePerDay).toBe(50);
    expect(res.explanation).toContain('5%');
  });

  it('calculateFine(2): under the flat cap → 100', async () => {
    const res = await service.calculateFine(2);
    expect(res.totalFine).toBe(100);
  });

  it('calculateFine(0): no fine', async () => {
    const res = await service.calculateFine(0);
    expect(res.totalFine).toBe(0);
  });
});
