import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentQueryService } from './payment-query.service';

const D = (value: string) => new Prisma.Decimal(value);
const paidRow = (id: string) => ({
  id, status: 'PAID', amountDue: D('4472'), amountPaid: D('4472'), lateFee: D('0'),
  lateFeeWaived: false, waivedAmount: null, dueDate: new Date('2026-09-08'), installmentNo: 4,
  contract: { id: `contract-${id}` },
});
function setup(rows: ReturnType<typeof paidRow>[], receipts: { paymentId: string; _sum: { amount: Prisma.Decimal | null } }[], entries: unknown[] = []) {
  const receiptGroupBy = jest.fn().mockResolvedValue(receipts);
  const prisma = {
    payment: { findMany: jest.fn().mockResolvedValue(rows), count: jest.fn().mockResolvedValue(rows.length), groupBy: jest.fn().mockResolvedValue([]) },
    receipt: { groupBy: receiptGroupBy },
    systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    journalEntry: { findMany: jest.fn().mockResolvedValue(entries) },
  };
  return { service: new PaymentQueryService(prisma as unknown as PrismaService), receiptGroupBy, journalFindMany: prisma.journalEntry.findMany };
}

describe('paid payment listing — receipt cash versus settlement', () => {
  it('returns bundled cash and final cash net of parked advance without changing settlement balances', async () => {
    const { service, receiptGroupBy } = setup([paidRow('bundle'), paidRow('last')], [
      { paymentId: 'bundle', _sum: { amount: D('5516') } },
      { paymentId: 'last', _sum: { amount: D('3428') } },
    ]);
    const result = await service.getPendingPayments({ status: 'PAID' });
    expect(result.data).toEqual([
      expect.objectContaining({ id: 'bundle', receiptCashAmount: '5516.00', amountDue: D('4472'), amountPaid: D('4472') }),
      expect.objectContaining({ id: 'last', receiptCashAmount: '3428.00', amountDue: D('4472'), amountPaid: D('4472') }),
    ]);
    expect(receiptGroupBy).toHaveBeenCalledTimes(1);
    expect(receiptGroupBy).toHaveBeenCalledWith({
      by: ['paymentId'],
      where: { paymentId: { in: ['bundle', 'last'] }, receiptType: { in: ['INSTALLMENT', 'PAYMENT'] }, isVoided: false, deletedAt: null },
      _sum: { amount: true },
    });
  });
  it('keeps missing receipt evidence unavailable instead of inventing zero or using amountPaid', async () => {
    const { service } = setup([paidRow('missing')], []);
    const result = await service.getPendingPayments({ status: 'PAID' });
    expect(result.data[0]).toEqual(expect.objectContaining({ receiptCashAmount: null, amountPaid: D('4472') }));
  });
  it('accepts a proven zero sum separately from unavailable evidence and aggregates all partial receipts', async () => {
    const { service } = setup([paidRow('zero'), paidRow('partials')], [
      { paymentId: 'zero', _sum: { amount: D('0') } },
      { paymentId: 'partials', _sum: { amount: D('6209') } },
    ]);
    const result = await service.getPendingPayments({ status: 'PAID' });
    expect(result.data).toEqual([
      expect.objectContaining({ receiptCashAmount: '0.00' }),
      expect.objectContaining({ receiptCashAmount: '6209.00' }),
    ]);
  });
  it('does not query receipt cash or change the pending queue settlement fields', async () => {
    const pending = { ...paidRow('pending'), status: 'PARTIALLY_PAID', amountPaid: D('3179') };
    const { service, receiptGroupBy } = setup([pending], []);
    const result = await service.getPendingPayments({});
    expect(receiptGroupBy).not.toHaveBeenCalled();
    expect(result.data[0]).not.toHaveProperty('receiptCashAmount');
    expect(result.data[0].amountPaid).toEqual(D('3179'));
  });
});


describe('paid receipt cash completeness', () => {
  const receiptEntry = (deltaApplied: unknown, extra: Record<string, unknown> = {}) => ({
    status: 'POSTED', deletedAt: null, lines: [],
    metadata: { tag: 'receipt', paymentId: 'partials', deltaApplied }, ...extra,
  });

  it('does not show a partial total when a committed collection has no issued receipt', async () => {
    const { service, journalFindMany } = setup([paidRow('partials')], [
      { paymentId: 'partials', _sum: { amount: D('3030') } },
    ], [receiptEntry('3179'), receiptEntry('3030')]);
    const result = await service.getPendingPayments({ status: 'PAID' });
    expect(result.data[0]).toEqual(expect.objectContaining({ receiptCashAmount: null, amountPaid: D('4472') }));
    expect(journalFindMany).toHaveBeenCalledTimes(1);
  });

  it('accepts the complete receipt sum, excluding reversed and noncash credit entries', async () => {
    const { service } = setup([paidRow('partials')], [
      { paymentId: 'partials', _sum: { amount: D('6209') } },
    ], [
      receiptEntry('3179'), receiptEntry('3030'),
      receiptEntry('9999', { metadata: { tag: 'receipt', paymentId: 'partials', deltaApplied: '9999', reversed: true } }),
      receiptEntry(undefined, { metadata: { tag: '2B', paymentId: 'partials', consumeAmount: '1044' } }),
    ]);
    expect((await service.getPendingPayments({ status: 'PAID' })).data[0].receiptCashAmount).toBe('6209.00');
  });

  it('retains legacy receipt evidence when missing or invalid cash metadata cannot prove a shortage', async () => {
    const { service } = setup([paidRow('partials')], [
      { paymentId: 'partials', _sum: { amount: D('6209') } },
    ], [receiptEntry('3030'), receiptEntry(undefined), receiptEntry('bad'), receiptEntry('Infinity'), receiptEntry('-50')]);
    expect((await service.getPendingPayments({ status: 'PAID' })).data[0].receiptCashAmount).toBe('6209.00');
  });
});
