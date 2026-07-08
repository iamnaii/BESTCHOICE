import { Decimal } from '@prisma/client/runtime/library';
import { reconstructPriorCleared } from './reconstruct-prior';

/**
 * reconstructPriorCleared rebuilds "how much of this installment is already
 * cleared" from prior JE lines. Un-pay fix (2026-07-08): originals stamped
 * `metadata.reversed=true` by ReceiptVoidReversalTemplate (receipt void /
 * refund reversal) must be SKIPPED — otherwise a voided installment still
 * counts as cleared and the next receipt throws "งวดนี้ถูกชำระครบแล้ว".
 */
describe('reconstructPriorCleared', () => {
  const INSTALLMENT_TOTAL = new Decimal('4472');

  const clientWith = (entries: any[]) =>
    ({
      journalEntry: { findMany: jest.fn().mockResolvedValue(entries) },
    }) as any;

  const line = (accountCode: string, credit: string, debit = '0') => ({
    accountCode,
    credit,
    debit,
  });

  it('sums Cr 11-2103 (principal) and Cr 42-1103 (late fee) from live receipt JEs', async () => {
    const client = clientWith([
      {
        metadata: { tag: 'receipt', installmentScheduleId: 'is-1' },
        lines: [line('11-2103', '1500'), line('42-1103', '75.79')],
      },
      {
        metadata: { tag: 'receipt', installmentScheduleId: 'is-1' },
        lines: [line('11-2103', '500')],
      },
    ]);

    const r = await reconstructPriorCleared(client, 'is-1', INSTALLMENT_TOTAL);

    expect(r.priorPrincipalCleared.toString()).toBe('2000');
    expect(r.priorLateFeeBooked.toString()).toBe('75.79');
  });

  it('skips originals stamped metadata.reversed=true (receipt void / refund reversal)', async () => {
    const client = clientWith([
      {
        // fully-clearing receipt JE that has since been voided
        metadata: { tag: 'receipt', installmentScheduleId: 'is-1', reversed: true },
        lines: [line('11-2103', '4472'), line('42-1103', '75.79')],
      },
      {
        metadata: { tag: 'receipt', installmentScheduleId: 'is-1' },
        lines: [line('11-2103', '500')],
      },
    ]);

    const r = await reconstructPriorCleared(client, 'is-1', INSTALLMENT_TOTAL);

    expect(r.priorPrincipalCleared.toString()).toBe('500');
    expect(r.priorLateFeeBooked.toString()).toBe('0');
  });

  it('still excludes a live legacy 2B full-clear but includes a legacy 2B partial', async () => {
    const client = clientWith([
      {
        // legacy full-clear (Cr == installmentTotal) — excluded by discriminator
        metadata: { tag: '2B', installmentScheduleId: 'is-1' },
        lines: [line('11-2103', '4472')],
      },
      {
        // legacy partial — included
        metadata: { tag: '2B', installmentScheduleId: 'is-1' },
        lines: [line('11-2103', '300')],
      },
    ]);

    const r = await reconstructPriorCleared(client, 'is-1', INSTALLMENT_TOTAL);

    expect(r.priorPrincipalCleared.toString()).toBe('300');
  });

  it('always includes advance-consume-on-accrual JEs — unless they were reversed', async () => {
    const client = clientWith([
      {
        metadata: {
          tag: '2B',
          flow: 'advance-consume-on-accrual',
          installmentScheduleId: 'is-1',
        },
        lines: [line('11-2103', '4472')],
      },
    ]);
    const live = await reconstructPriorCleared(client, 'is-1', INSTALLMENT_TOTAL);
    expect(live.priorPrincipalCleared.toString()).toBe('4472');

    const reversedClient = clientWith([
      {
        metadata: {
          tag: '2B',
          flow: 'advance-consume-on-accrual',
          installmentScheduleId: 'is-1',
          reversed: true,
        },
        lines: [line('11-2103', '4472')],
      },
    ]);
    const reversed = await reconstructPriorCleared(reversedClient, 'is-1', INSTALLMENT_TOTAL);
    expect(reversed.priorPrincipalCleared.toString()).toBe('0');
  });
});
