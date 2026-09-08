import { describe, expect, it } from 'vitest';
import { computeReceiptLateFee } from '../receiptLateFee';
import { computeNetReceiptDue } from '../computeNetReceiptDue';
import { computeGateRemaining } from '../computeGateRemaining';
import { draftToFormValues, type PaymentDraftRow } from '../draftHydration';

const payment = { amountDue: '6079', amountPaid: '3179', lateFee: '100', installmentNo: 2,
  contract: { totalMonths: 10, advanceBalance: '0' } };

describe('late fee on a subsequent receipt', () => {
  it('shows zero after the first receipt paid the fee, while keeping cash due at 3000', () => {
    const fee = computeReceiptLateFee('100', '100');
    expect(fee.remaining.toFixed(2)).toBe('0.00');
    expect(fee.gross.toFixed(2)).toBe('100.00');
    expect(fee.additional.toFixed(2)).toBe('0.00');
    expect(computeNetReceiptDue({ ...payment, lateFee: fee.gross }).toFixed(2)).toBe('3000.00');
  });

  it('collects only an explicit extra 50 and carries a gross target of 150 through the submit gate', () => {
    const fee = computeReceiptLateFee('100', '100', '50');
    expect(fee.remaining.toFixed(2)).toBe('50.00');
    expect(fee.gross.toFixed(2)).toBe('150.00');
    expect(fee.additional.toFixed(2)).toBe('50.00');
    expect(computeNetReceiptDue({ ...payment, lateFee: fee.gross }).toFixed(2)).toBe('3050.00');
    expect(computeGateRemaining(payment, { consumeAdvance: true, lateFee: fee.gross.toNumber() })).toBe(3050);
  });

  it('keeps the uncollected remainder when the first receipt paid only part of the fee', () => {
    const fee = computeReceiptLateFee('100', '40');
    expect(fee.remaining.toFixed(2)).toBe('60.00');
    expect(fee.gross.toFixed(2)).toBe('100.00');
    expect(fee.additional.toFixed(2)).toBe('0.00');
    expect(computeReceiptLateFee('100', '40', '59').reduced).toBe(true);
    expect(computeReceiptLateFee('100', '40', '75').additional.toFixed(2)).toBe('15.00');
  });

  it('preserves the first-receipt behavior for older callers without a paid-fee field', () => {
    const fee = computeReceiptLateFee('100');
    expect(fee.remaining.toFixed(2)).toBe('100.00');
    expect(fee.gross.toFixed(2)).toBe('100.00');
    expect(fee.additional.toFixed(2)).toBe('0.00');
  });

  it('hydrates a stored cumulative draft fee back into the current receipt field', () => {
    const draft: PaymentDraftRow = { id: 'draft', amount: '3050', paymentMethod: 'CASH',
      depositAccountCode: '11-1101', lateFee: '150', additionalLateFee: '50',
      lateFeeWaiverAmount: null, lateFeeWaiverReasonCode: null, waiverApproverId: null,
      consumeAdvance: true, paidDate: null, paymentCase: 'NORMAL', transactionRef: null,
      evidenceUrl: null, notes: null };
    const values = draftToFormValues(draft, { lateFee: '0.00', lateFeePaid: '100',
      depositAccountCode: '11-1101', paidDate: '2026-09-08' });
    expect(values.lateFee).toBe('50.00');
    const restored = computeReceiptLateFee('100', '100', values.lateFee);
    expect(restored.gross.toFixed(2)).toBe('150.00');
    expect(restored.additional.toFixed(2)).toBe('50.00');
  });
});
