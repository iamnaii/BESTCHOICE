import { Prisma } from '@prisma/client';
import { loadLateFeePaidByPaymentIds } from './payment-late-fee-paid.util';

const D = (v: number | string) => new Prisma.Decimal(v);
const line = (accountCode: string, debit = 0, credit = 0) => ({ accountCode, debit: D(debit), credit: D(credit), deletedAt: null });
const entry = (overrides: Record<string, unknown> = {}) => ({
  status: 'POSTED', deletedAt: null, metadata: { tag: 'receipt', paymentId: 'p1' },
  lines: [line('42-1103', 0, 100)], ...overrides,
});
const client = (entries: unknown[]) => ({ journalEntry: { findMany: jest.fn().mockResolvedValue(entries) } });

describe('loadLateFeePaidByPaymentIds', () => {
  it('batches exact payment IDs and sums current/legacy receipt fees without inferring a fee', async () => {
    const prisma = client([entry(), entry({ metadata: { tag: '2B', paymentId: 'p1' }, lines: [line('42-1103', 0, 25)] })]);
    const out = await loadLateFeePaidByPaymentIds(prisma as never, ['p1', 'p2', 'p1']);
    expect(out.get('p1')?.toFixed(2)).toBe('125.00');
    expect(out.get('p2')?.toFixed(2)).toBe('0.00');
    expect(prisma.journalEntry.findMany).toHaveBeenCalledTimes(1);
    const query = prisma.journalEntry.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ status: 'POSTED', deletedAt: null });
    expect(query.where.AND[0].OR).toEqual([
      { metadata: { path: ['paymentId'], equals: 'p1' } },
      { metadata: { path: ['paymentId'], equals: 'p2' } },
    ]);
  });

  it('subtracts the current gross-waiver discount from the credited fee', async () => {
    const prisma = client([entry({ lines: [line('42-1103', 0, 100), line('52-1105', 50), line('11-1101', 3000)] })]);
    const out = await loadLateFeePaidByPaymentIds(prisma as never, ['p1']);
    expect(out.get('p1')?.toFixed(2)).toBe('50.00');
  });

  it('ignores reversed, unposted, deleted, other-payment and unrelated entries', async () => {
    const prisma = client([
      entry({ metadata: { tag: 'receipt', paymentId: 'p1', reversed: true } }),
      entry({ status: 'DRAFT' }), entry({ deletedAt: new Date() }),
      entry({ metadata: { tag: 'receipt', paymentId: 'p10' } }),
      entry({ metadata: { tag: 'receipt-void', paymentId: 'p1' } }),
      entry({ lines: [{ ...line('42-1103', 0, 100), deletedAt: new Date() }] }),
    ]);
    const out = await loadLateFeePaidByPaymentIds(prisma as never, ['p1']);
    expect(out.get('p1')?.toFixed(2)).toBe('0.00');
  });

  it('does not query the ledger for an empty page', async () => {
    const prisma = client([]);
    expect((await loadLateFeePaidByPaymentIds(prisma as never, [])).size).toBe(0);
    expect(prisma.journalEntry.findMany).not.toHaveBeenCalled();
  });
});
