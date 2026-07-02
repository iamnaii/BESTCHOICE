import { describe, it, expect } from 'vitest';
import { computeNetReceiptDue } from '../computeNetReceiptDue';

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
});
