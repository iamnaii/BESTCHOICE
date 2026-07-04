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

  it('PAID installment keeps the STORED fee — never recomputed from now − dueDate (ชำระครบ tab)', async () => {
    // Paid on time (charged fee = 0), viewed 30 days after the due date: a
    // live recompute would fabricate a 5%-cap fee that was never collected.
    const service = makeService([
      { id: 'p4', status: 'PAID', dueDate: daysAgo(30), amountDue: D('3671'), amountPaid: D('3671'), lateFeeWaived: false, lateFee: D('0'), contract: {} },
    ]);
    const res = await service.getPendingPayments({ status: 'PAID' });
    expect(lateFeeNum(res.data[0])).toBe(0);
  });

  it('PAID installment that DID pay a fee keeps that charged amount', async () => {
    const service = makeService([
      { id: 'p5', status: 'PAID', dueDate: daysAgo(60), amountDue: D('3671'), amountPaid: D('3731'), lateFeeWaived: false, lateFee: D('60'), contract: {} },
    ]);
    const res = await service.getPendingPayments({ status: 'PAID' });
    expect(lateFeeNum(res.data[0])).toBe(60);
  });

  it('PAID + gross-waiver (PR #1313): returns the NET fee — gross stamp minus waivedAmount', async () => {
    // Wizard waiver keeps lateFee at GROSS (Cr 42-1103) and books the discount
    // in waivedAmount (Dr 52-1105). Fully waived → net 0, not a fake 100฿ "underpay".
    const service = makeService([
      { id: 'p6', status: 'PAID', dueDate: daysAgo(20), amountDue: D('3671'), amountPaid: D('3671'), lateFeeWaived: true, lateFee: D('100'), waivedAmount: D('100'), contract: {} },
    ]);
    const res = await service.getPendingPayments({ status: 'PAID' });
    expect(lateFeeNum(res.data[0])).toBe(0);
  });

  it('PAID + partial waiver: net = gross − waived', async () => {
    const service = makeService([
      { id: 'p7', status: 'PAID', dueDate: daysAgo(20), amountDue: D('3671'), amountPaid: D('3731'), lateFeeWaived: true, lateFee: D('100'), waivedAmount: D('40'), contract: {} },
    ]);
    const res = await service.getPendingPayments({ status: 'PAID' });
    expect(lateFeeNum(res.data[0])).toBe(60);
  });

  it('PAID + standalone waiver (lateFee already zeroed, waivedAmount set): clamps at 0, never negative', async () => {
    const service = makeService([
      { id: 'p8', status: 'PAID', dueDate: daysAgo(20), amountDue: D('3671'), amountPaid: D('3671'), lateFeeWaived: true, lateFee: D('0'), waivedAmount: D('100'), contract: {} },
    ]);
    const res = await service.getPendingPayments({ status: 'PAID' });
    expect(lateFeeNum(res.data[0])).toBe(0);
  });
});
