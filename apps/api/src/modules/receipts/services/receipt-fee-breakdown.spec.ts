import { Prisma } from '@prisma/client';
import { attachReceiptFeeBreakdowns } from './receipt-fee-breakdown';

const receipt = (id: string, amount: string, overrides = {}) => ({
  id, amount: new Prisma.Decimal(amount), paymentId: 'p1', contractId: 'c1',
  receiptType: 'INSTALLMENT', paidDate: new Date('2026-09-08T00:00:00Z'),
  isVoided: false, sourceJournalEntryId: null, ...overrides,
});
const journal = (id: string, amount: string, fee: string, overrides = {}) => ({
  id, postedAt: new Date('2026-09-08T00:00:00Z'),
  metadata: { tag: 'receipt', flow: 'payment-receipt', paymentId: 'p1', contractId: 'c1', deltaApplied: amount },
  lines: [{ accountCode: '42-1103', debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(fee) }],
  ...overrides,
});
function prisma(siblings: ReturnType<typeof receipt>[], entries: ReturnType<typeof journal>[]) {
  return {
    receipt: { findMany: jest.fn().mockResolvedValue(siblings) },
    journalEntry: { findMany: jest.fn().mockResolvedValue(entries) },
  };
}

describe('receipt fee history from its own journal', () => {
  it('keeps 100 on receipt 2/1 while a linked later receipt carries only the manually added 50', async () => {
    const first = receipt('r1', '3179');
    const second = receipt('r2', '3050', { sourceJournalEntryId: 'j2' });
    const db = prisma([first, second], [journal('j1', '3179', '100'), journal('j2', '3050', '50')]);
    const rows = await attachReceiptFeeBreakdowns(db as never, [first, second]);
    expect(rows.map((r) => [r.lateFeeCollected, r.lateFeeWaivedThisReceipt])).toEqual([
      ['100.00', '0.00'], ['50.00', '0.00'],
    ]);
    expect(rows.every((r) => r.hasReceiptFeeHistory)).toBe(true);
  });

  it('returns an authoritative zero for the follow-up receipt without a new penalty', async () => {
    const first = receipt('r1', '3179');
    const second = receipt('r2', '3000', { sourceJournalEntryId: 'j2' });
    const db = prisma([first, second], [journal('j1', '3179', '100'), journal('j2', '3000', '0')]);
    const [row] = await attachReceiptFeeBreakdowns(db as never, [second]);
    expect(row).toMatchObject({ lateFeeCollected: '0.00', lateFeeWaivedThisReceipt: '0.00', hasReceiptFeeHistory: true });
  });

  it('reads gross fee less actual waiver without attributing that waiver to an earlier sibling', async () => {
    const row = receipt('r2', '3000', { sourceJournalEntryId: 'j2' });
    const entry = journal('j2', '3000', '50');
    entry.lines.push({ accountCode: '52-1105', debit: new Prisma.Decimal('20'), credit: new Prisma.Decimal(0) });
    const [result] = await attachReceiptFeeBreakdowns(prisma([row], [entry]) as never, [row]);
    expect(result).toMatchObject({ lateFeeCollected: '30.00', lateFeeWaivedThisReceipt: '20.00' });
  });

  it('does not guess between repeated legacy amounts even when only one receipt is requested', async () => {
    const first = receipt('r1', '1000');
    const second = receipt('r2', '1000');
    const third = receipt('r3', '3050', { sourceJournalEntryId: 'j3' });
    const db = prisma([first, second, third], [journal('j1', '1000', '100'), journal('j3', '3050', '50')]);
    const [result] = await attachReceiptFeeBreakdowns(db as never, [first]);
    expect(result).toMatchObject({ lateFeeCollected: null, lateFeeWaivedThisReceipt: null, hasReceiptFeeHistory: true });
    expect(db.receipt.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { paymentId: { in: ['p1'] }, receiptType: { in: ['INSTALLMENT', 'PAYMENT'] }, deletedAt: null },
    }));
  });

  it('compares Bangkok business dates and excludes already reversed legacy entries', async () => {
    const row = receipt('r1', '1000', { paidDate: new Date('2026-09-07T17:00:00Z') });
    const valid = journal('j1', '1000', '100', { postedAt: new Date('2026-09-08T08:00:00Z') });
    const reversed = journal('j0', '1000', '200', { metadata: { ...valid.metadata, reversed: true } });
    const [result] = await attachReceiptFeeBreakdowns(prisma([row], [reversed, valid]) as never, [row]);
    expect(result.lateFeeCollected).toBe('100.00');
  });

  it('does not accept a source link to another payment or a reversal', async () => {
    const row = receipt('r1', '1000', { sourceJournalEntryId: 'j1' });
    const wrong = journal('j1', '1000', '100', { metadata: { tag: 'receipt', paymentId: 'other', contractId: 'c1' } });
    const [result] = await attachReceiptFeeBreakdowns(prisma([row], [wrong]) as never, [row]);
    expect(result).toMatchObject({ lateFeeCollected: null, hasReceiptFeeHistory: false });
  });

  it('leaves cumulative or missing legacy JE evidence unresolved', async () => {
    const row = receipt('r1', '1000');
    const legacy = journal('j1', '1000', '100', { metadata: { tag: '2B', paymentId: 'p1', contractId: 'c1' } });
    const [result] = await attachReceiptFeeBreakdowns(prisma([row], [legacy]) as never, [row]);
    expect(result).toMatchObject({ lateFeeCollected: null, lateFeeWaivedThisReceipt: null, hasReceiptFeeHistory: false });
  });
});
