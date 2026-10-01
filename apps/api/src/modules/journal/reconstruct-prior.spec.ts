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

  /**
   * C-1 (final review 2026-08-16). InstallmentAccrual2ATemplate's
   * last-installment park relief (ค่าปรับดิวพักงวดสุดท้าย) also stamps
   * `tag:'2B'`, so it is SELECTED here — but before the fix only
   * `advance-consume-on-accrual` was on the always-include branch, so a park
   * consume equal to installmentTotal fell into the legacy full-clear rule and
   * was DROPPED. The next receipt then re-cleared the whole installment →
   * Σ(Cr 11-2103) = 2 × installmentTotal.
   */
  it('always includes reschedule-park-consume JEs — including a FULL clear (C-1)', async () => {
    const client = clientWith([
      {
        metadata: {
          tag: '2B',
          flow: 'reschedule-park-consume',
          installmentScheduleId: 'is-1',
        },
        // Cr == installmentTotal exactly: the case the legacy discriminator drops.
        lines: [line('11-2103', '4472')],
      },
    ]);
    const live = await reconstructPriorCleared(client, 'is-1', INSTALLMENT_TOTAL);
    expect(live.priorPrincipalCleared.toString()).toBe('4472');

    const reversedClient = clientWith([
      {
        metadata: {
          tag: '2B',
          flow: 'reschedule-park-consume',
          installmentScheduleId: 'is-1',
          reversed: true,
        },
        lines: [line('11-2103', '4472')],
      },
    ]);
    const reversed = await reconstructPriorCleared(reversedClient, 'is-1', INSTALLMENT_TOTAL);
    expect(reversed.priorPrincipalCleared.toString()).toBe('0');
  });

  it('counts BOTH 2A relief flows on the same installment (generic FIFO + last-installment park)', async () => {
    const client = clientWith([
      {
        metadata: {
          tag: '2B',
          flow: 'advance-consume-on-accrual',
          installmentScheduleId: 'is-1',
        },
        lines: [line('11-2103', '1000')],
      },
      {
        metadata: {
          tag: '2B',
          flow: 'reschedule-park-consume',
          installmentScheduleId: 'is-1',
        },
        lines: [line('11-2103', '3472')],
      },
    ]);

    const r = await reconstructPriorCleared(client, 'is-1', INSTALLMENT_TOTAL);
    // 1000 + 3472 == installmentTotal → the next receipt has nothing left to clear.
    expect(r.priorPrincipalCleared.toString()).toBe('4472');
  });

  it('ใบกำกับภาษีตามบัญชี (PR3): priorClearings = Cr 11-2103 ต่อรายการ เรียงตามลำดับที่ลง · ข้ามรายการที่ถูกกลับ / 2B เต็มงวดแบบเดิม / รายการที่ล้างลูกหนี้ 0', async () => {
    const at = (iso: string) => new Date(iso);
    const client = clientWith([
      {
        entryNumber: 'JE-202610-00009',
        createdAt: at('2026-10-05T03:00:00Z'),
        metadata: { tag: 'receipt', installmentScheduleId: 'is-1' },
        lines: [line('11-2103', '600')],
      },
      {
        entryNumber: 'JE-202610-00003',
        createdAt: at('2026-10-01T03:00:00Z'),
        metadata: { tag: 'receipt', installmentScheduleId: 'is-1' },
        lines: [line('11-2103', '500'), line('42-1103', '50')],
      },
      {
        entryNumber: 'JE-202610-00004',
        createdAt: at('2026-10-02T03:00:00Z'),
        metadata: { tag: 'receipt', installmentScheduleId: 'is-1', reversed: true },
        lines: [line('11-2103', '999')],
      },
      {
        entryNumber: 'JE-202610-00005',
        createdAt: at('2026-10-03T03:00:00Z'),
        metadata: { tag: '2B', installmentScheduleId: 'is-1' },
        lines: [line('11-2103', '4472')],
      },
      {
        entryNumber: 'JE-202610-00006',
        createdAt: at('2026-10-04T03:00:00Z'),
        metadata: { tag: 'receipt', installmentScheduleId: 'is-1' },
        lines: [line('53-1503', '0.17')],
      },
    ]);

    const r = await reconstructPriorCleared(client, 'is-1', INSTALLMENT_TOTAL);

    expect(r.priorClearings.map((d) => d.toFixed(2))).toEqual(['500.00', '600.00']);
    expect(r.priorPrincipalCleared.toFixed(2)).toBe('1100.00');
    expect(r.priorLateFeeBooked.toFixed(2)).toBe('50.00');
  });
});
