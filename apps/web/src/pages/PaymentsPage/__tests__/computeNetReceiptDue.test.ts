import { describe, it, expect } from 'vitest';
import { computeNetReceiptDue, computeRemainingObligation } from '../computeNetReceiptDue';

describe('computeNetReceiptDue', () => {
  it('includes the late fee in a fresh overdue installment (the bug: full must be full)', () => {
    // ค่างวด 3,671 + ค่าปรับ 100 → "เต็มงวด" = 3,771 (NOT 3,671)
    expect(
      computeNetReceiptDue({ amountDue: '3671', lateFee: '100', amountPaid: '0' }).toFixed(2),
    ).toBe('3771.00');
  });

  it('leaves only the late fee when the base is already paid', () => {
    // amountPaid = amountDue (base settled) → คงค้าง = 100 (the late fee)
    expect(
      computeNetReceiptDue({ amountDue: '3671', lateFee: '100', amountPaid: '3671' }).toFixed(2),
    ).toBe('100.00');
  });

  it('subtracts a late-fee waiver (clamped to the gross late fee)', () => {
    expect(
      computeNetReceiptDue({ amountDue: '3671', lateFee: '100', amountPaid: '0', waiver: '100' }).toFixed(2),
    ).toBe('3671.00');
    // waiver above gross is clamped — cannot go below the base
    expect(
      computeNetReceiptDue({ amountDue: '3671', lateFee: '100', amountPaid: '0', waiver: '999' }).toFixed(2),
    ).toBe('3671.00');
  });

  it('consumes the advance balance when the credit toggle is on', () => {
    expect(
      computeNetReceiptDue({
        amountDue: '3671',
        lateFee: '100',
        amountPaid: '0',
        advanceBalance: '500',
        consumeAdvance: true,
      }).toFixed(2),
    ).toBe('3271.00');
  });

  it('ignores the advance balance when the credit toggle is off', () => {
    expect(
      computeNetReceiptDue({
        amountDue: '3671',
        lateFee: '100',
        amountPaid: '0',
        advanceBalance: '500',
        consumeAdvance: false,
      }).toFixed(2),
    ).toBe('3771.00');
  });

  it('never returns a negative amount (advance larger than owed)', () => {
    expect(
      computeNetReceiptDue({
        amountDue: '1000',
        lateFee: '0',
        amountPaid: '0',
        advanceBalance: '5000',
        consumeAdvance: true,
      }).toFixed(2),
    ).toBe('0.00');
  });

  // ── PR #1314 gap-fill: principal-first partial payments (0 < amountPaid < base) ──
  // The existing suite only covered amountPaid == 0 (fresh) and amountPaid == amountDue
  // (base settled). These pin the in-between band, where the base is PARTLY paid and the
  // late fee is still outstanding — the exact state the wizard prefill must not drop.
  it('still includes the full late fee when the base is only PARTLY paid', () => {
    // 3671 base, 100 fee, 2000 already paid → 3671 + 100 − 2000 = 1771
    expect(
      computeNetReceiptDue({ amountDue: '3671', lateFee: '100', amountPaid: '2000' }).toFixed(2),
    ).toBe('1771.00');
  });

  it('partial base + partial waiver: net fee (fee − waiver) rides on top of the base remainder', () => {
    // owed = 3671 + (100 − 40) − 2000 = 1731
    expect(
      computeNetReceiptDue({
        amountDue: '3671',
        lateFee: '100',
        amountPaid: '2000',
        waiver: '40',
      }).toFixed(2),
    ).toBe('1731.00');
  });

  it('partial base + advance consume: advance is deducted after the fee is added', () => {
    // owed = 3671 + 100 − 2000 = 1771; consume min(500, 1771) = 500 → 1271
    expect(
      computeNetReceiptDue({
        amountDue: '3671',
        lateFee: '100',
        amountPaid: '2000',
        advanceBalance: '500',
        consumeAdvance: true,
      }).toFixed(2),
    ).toBe('1271.00');
  });

  it('returns 0 when an overpayment has already cleared base + late fee', () => {
    // amountPaid (4000) >= amountDue + lateFee (3771) → nothing owed
    expect(
      computeNetReceiptDue({ amountDue: '3671', lateFee: '100', amountPaid: '4000' }).toFixed(2),
    ).toBe('0.00');
  });

  it('applies waiver + advance + partial payment together (all reducers at once)', () => {
    // owed = 1000 + (200 − 50) − 300 = 850; consume min(100, 850) = 100 → 750
    expect(
      computeNetReceiptDue({
        amountDue: '1000',
        lateFee: '200',
        amountPaid: '300',
        waiver: '50',
        advanceBalance: '100',
        consumeAdvance: true,
      }).toFixed(2),
    ).toBe('750.00');
  });
});

/* ─── computeRemainingObligation ───────────────────────
 * The wizard's CaseBadge/diff must compare cash against what the customer STILL
 * owes (net of amountPaid) — the same `remaining` the server orchestrator uses.
 * Before 2026-08-18 it compared against amountDue + netLateFee WITHOUT
 * subtracting amountPaid: on prod TEST-20260802-001 (ค่างวด 8,925 + ค่าปรับ 100,
 * จ่ายแล้ว 1,000) paying the ยอดเหลือ 8,025 in full showed
 * "จ่ายขาด 1,000.00 ฿ — ลูกค้าค้าง 1,000.00 ฿ ต่อ" while the server would have
 * recorded a full clear.
 */
describe('computeRemainingObligation', () => {
  it('subtracts what was already paid (prod TEST-20260802-001 numbers)', () => {
    const remaining = computeRemainingObligation({
      amountDue: 8925,
      lateFee: 100,
      amountPaid: 1000,
    });
    expect(remaining.toFixed(2)).toBe('8025.00');
  });

  it('fresh installment (nothing paid) equals amountDue + lateFee', () => {
    const remaining = computeRemainingObligation({ amountDue: 8925, lateFee: 100, amountPaid: 0 });
    expect(remaining.toFixed(2)).toBe('9025.00');
  });

  it('waiver reduces the obligation, clamped to the gross fee', () => {
    const remaining = computeRemainingObligation({
      amountDue: 8925,
      lateFee: 100,
      amountPaid: 1000,
      waiver: 250,
    });
    expect(remaining.toFixed(2)).toBe('7925.00');
  });

  it('is the pre-advance base of computeNetReceiptDue (single formula, no drift)', () => {
    const input = { amountDue: 8925, lateFee: 100, amountPaid: 1000, waiver: 40 };
    const viaNet = computeNetReceiptDue({ ...input, advanceBalance: 0 });
    expect(computeRemainingObligation(input).toFixed(2)).toBe(viaNet.toFixed(2));
  });
});
