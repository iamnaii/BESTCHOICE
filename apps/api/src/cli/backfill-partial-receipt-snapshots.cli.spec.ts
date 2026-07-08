import { Prisma } from '@prisma/client';
import {
  recomputeInstallmentSnapshots,
  SnapshotRow,
} from './backfill-partial-receipt-snapshots.cli';

const D = (v: string | number) => new Prisma.Decimal(v.toString());

const row = (over: Partial<SnapshotRow> & { id: string }): SnapshotRow => ({
  receiptNumber: over.id,
  amount: D(0),
  createdAt: new Date('2026-07-01T10:00:00Z'),
  isVoided: false,
  voidApprovedAt: null,
  paymentStatus: 'PAID',
  installmentPartialSeq: null,
  remainingAmount: null,
  ...over,
});

describe('recomputeInstallmentSnapshots', () => {
  it('repairs the CN-pollution case: partial receipt after two voided full payments (RT-00005 shape)', () => {
    // Timeline: full 8,925 (voided later), full 8,925 (voided later), partial 1,000.
    // Old writer summed the CNs → remaining clamped to 0, seq 3. Correct
    // snapshot for the 1,000 partial: seq=1, remaining=7,925.
    const t = (m: number) => new Date(Date.UTC(2026, 6, 1, 10, m));
    const receipts: SnapshotRow[] = [
      row({ id: 'r1', amount: D('8925'), createdAt: t(0), isVoided: true, voidApprovedAt: t(5) }),
      row({ id: 'r2', amount: D('8925'), createdAt: t(10), isVoided: true, voidApprovedAt: t(15) }),
      row({
        id: 'r3',
        amount: D('1000'),
        createdAt: t(20),
        paymentStatus: 'PARTIAL',
        installmentPartialSeq: 3,
        remainingAmount: D('0'),
      }),
    ];
    const fixes = recomputeInstallmentSnapshots(receipts, D('8925'));
    const r3 = fixes.find((f) => f.id === 'r3');
    expect(r3).toBeDefined();
    expect(r3!.paymentStatus).toBe('PARTIAL');
    expect(r3!.installmentPartialSeq).toBe(1);
    expect(r3!.remainingAmount.toString()).toBe('7925');
  });

  it('keeps a sibling voided AFTER issuance in the cumulative (writer saw it as valid)', () => {
    const t = (m: number) => new Date(Date.UTC(2026, 6, 1, 10, m));
    // partial 500 (later voided at t=30), then partial 300 at t=10 — at t=10
    // the 500 was still valid → cumulative 800, seq 2, remaining 715.83.
    const receipts: SnapshotRow[] = [
      row({
        id: 'p1',
        amount: D('500'),
        createdAt: t(0),
        isVoided: true,
        voidApprovedAt: t(30),
        paymentStatus: 'PARTIAL',
        installmentPartialSeq: 1,
        remainingAmount: D('1015.83'),
      }),
      row({
        id: 'p2',
        amount: D('300'),
        createdAt: t(10),
        paymentStatus: 'PARTIAL',
        installmentPartialSeq: 2,
        remainingAmount: D('715.83'),
      }),
    ];
    const fixes = recomputeInstallmentSnapshots(receipts, D('1515.83'));
    // Both rows already carry the correct snapshot → no fixes emitted.
    expect(fixes).toHaveLength(0);
  });

  it('final receipt that clears the installment → PAID / seq null / remaining 0', () => {
    const t = (m: number) => new Date(Date.UTC(2026, 6, 1, 10, m));
    const receipts: SnapshotRow[] = [
      row({
        id: 'a',
        amount: D('1000'),
        createdAt: t(0),
        paymentStatus: 'PARTIAL',
        installmentPartialSeq: 1,
        remainingAmount: D('7925'),
      }),
      row({
        id: 'b',
        amount: D('7925'),
        createdAt: t(10),
        // polluted: stamped PARTIAL/seq 2 by the old writer
        paymentStatus: 'PARTIAL',
        installmentPartialSeq: 2,
        remainingAmount: D('303.95'),
      }),
    ];
    const fixes = recomputeInstallmentSnapshots(receipts, D('8925'));
    expect(fixes).toHaveLength(1);
    expect(fixes[0].id).toBe('b');
    expect(fixes[0].paymentStatus).toBe('PAID');
    expect(fixes[0].installmentPartialSeq).toBeNull();
    expect(fixes[0].remainingAmount.toString()).toBe('0');
  });
});
