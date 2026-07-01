import { Prisma } from '@prisma/client';
import { PaymentQueryService } from './services/payment-query.service';

/**
 * getPendingPayments feeds the payment queue + RecordPaymentWizard. The stored
 * Payment.lateFee is a stamp refreshed only at record time / by the overdue cron,
 * so the read path must recompute it from current config to reflect settings edits.
 */
describe('PaymentQueryService — getPendingPayments live late fee', () => {
  const PER_DAY = ({ where: { key } }: { where: { key: string } }) => {
    const map: Record<string, string> = {
      late_fee_mode: 'PER_DAY',
      late_fee_per_day_rate: '20',
      late_fee_max_amount: '500',
      late_fee_cap_pct: '5',
    };
    return Promise.resolve(map[key] ? { value: map[key] } : null);
  };
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  function makeService(rows: Record<string, unknown>[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const count = jest.fn().mockResolvedValue(rows.length);
    const systemConfig = { findUnique: jest.fn(PER_DAY) };
    const prisma = { payment: { findMany, count }, systemConfig };
    return new PaymentQueryService(prisma as unknown as never);
  }

  const D = (v: string) => new Prisma.Decimal(v);
  const lateFeeNum = (row: { lateFee: { toString(): string } }) =>
    new Prisma.Decimal(row.lateFee.toString()).toNumber();

  it('overrides the stale stored stamp with the live PER_DAY 5% cap', async () => {
    const service = makeService([
      { id: 'p1', status: 'OVERDUE', dueDate: daysAgo(30), amountDue: D('3671'), amountPaid: D('0'), lateFeeWaived: false, lateFee: D('999'), contract: {} },
    ]);
    const res = await service.getPendingPayments({});
    expect(lateFeeNum(res.data[0])).toBe(183.55);
  });

  it('waived installment → 0 even when the stored stamp is non-zero', async () => {
    const service = makeService([
      { id: 'p2', status: 'OVERDUE', dueDate: daysAgo(30), amountDue: D('3671'), amountPaid: D('0'), lateFeeWaived: true, lateFee: D('183.55'), contract: {} },
    ]);
    const res = await service.getPendingPayments({});
    expect(lateFeeNum(res.data[0])).toBe(0);
  });

  it('not-yet-due installment → 0', async () => {
    const service = makeService([
      { id: 'p3', status: 'PENDING', dueDate: daysAgo(-5), amountDue: D('3671'), amountPaid: D('0'), lateFeeWaived: false, lateFee: D('0'), contract: {} },
    ]);
    const res = await service.getPendingPayments({});
    expect(lateFeeNum(res.data[0])).toBe(0);
  });
});
