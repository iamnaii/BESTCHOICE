import { describe, it, expect } from 'vitest';
import {
  computeCumulativePaid,
  computeFeeTotals,
  jesForReceipt,
  type ReceiptAmountRow,
  type FeePaymentRow,
  type JeRef,
} from '../paymentHistoryDerivations';

const rec = (over: Partial<ReceiptAmountRow>): ReceiptAmountRow => ({
  isVoided: false,
  receiptType: 'INSTALLMENT',
  amount: '0',
  ...over,
});

const pay = (over: Partial<FeePaymentRow>): FeePaymentRow => ({
  status: 'PENDING',
  amountPaid: '0',
  lateFee: '0',
  waivedAmount: null,
  lateFeeWaived: false,
  ...over,
});

const je = (over: Partial<JeRef>): JeRef => ({
  id: 'je',
  paymentId: null,
  flow: null,
  originalEntryId: null,
  ...over,
});

describe('computeCumulativePaid', () => {
  it('sums non-voided, non-CREDIT_NOTE receipt amounts', () => {
    const receipts = [
      rec({ receiptType: 'INSTALLMENT', amount: '1500' }),
      rec({ receiptType: 'EARLY_PAYOFF', amount: '500' }),
    ];
    expect(computeCumulativePaid(receipts)).toBe(2000);
  });

  it('excludes voided receipts and CREDIT_NOTE rows (a CN carries the original positive amount)', () => {
    const receipts = [
      rec({ receiptType: 'INSTALLMENT', amount: '1500' }),
      rec({ receiptType: 'INSTALLMENT', amount: '1000', isVoided: true }), // voided original
      rec({ receiptType: 'CREDIT_NOTE', amount: '1000' }), // the void's CN row
    ];
    expect(computeCumulativePaid(receipts)).toBe(1500);
  });

  it('returns 0 when every receipt is either voided or a credit note', () => {
    const receipts = [
      rec({ receiptType: 'INSTALLMENT', amount: '1000', isVoided: true }),
      rec({ receiptType: 'CREDIT_NOTE', amount: '1000' }),
    ];
    expect(computeCumulativePaid(receipts)).toBe(0);
  });
});

describe('computeFeeTotals', () => {
  it('counts the fee once collection has started via amountPaid > 0 (even if status is OVERDUE)', () => {
    // Simulates the midnight cron flipping a base-touched PARTIALLY_PAID row back to
    // OVERDUE — the fee must NOT vanish because amountPaid > 0.
    const payments = [pay({ status: 'OVERDUE', amountPaid: '2000', lateFee: '100' })];
    expect(computeFeeTotals(payments)).toEqual({ totalLateFee: 100, totalWaived: 0 });
  });

  it('counts the fee for a PAID installment', () => {
    const payments = [pay({ status: 'PAID', amountPaid: '3671', lateFee: '77' })];
    expect(computeFeeTotals(payments).totalLateFee).toBe(77);
  });

  it('excludes pure accruals (amountPaid 0 and not PAID) so untouched overdue rows do not inflate the card', () => {
    const payments = [
      pay({ status: 'OVERDUE', amountPaid: '0', lateFee: '100' }), // untouched → excluded
      pay({ status: 'PAID', amountPaid: '1000', lateFee: '50' }), // included
    ];
    expect(computeFeeTotals(payments).totalLateFee).toBe(50);
  });

  it('prefers waivedAmount, falling back to full lateFee when lateFeeWaived is set', () => {
    const payments = [
      pay({ status: 'PAID', amountPaid: '1', lateFee: '100', waivedAmount: '40' }), // explicit partial waiver
      pay({ status: 'PAID', amountPaid: '1', lateFee: '80', waivedAmount: null, lateFeeWaived: true }), // full waive
    ];
    expect(computeFeeTotals(payments)).toEqual({ totalLateFee: 180, totalWaived: 120 });
  });
});

describe('jesForReceipt', () => {
  it('EARLY_PAYOFF receipt matches JEs by flow (paymentId is null on the JP4 receipt)', () => {
    const jes = [je({ id: 'a', flow: 'early-payoff' }), je({ id: 'b', flow: null, paymentId: 'p1' })];
    const out = jesForReceipt({ receiptType: 'EARLY_PAYOFF', paymentId: null }, jes);
    expect(out.map((j) => j.id)).toEqual(['a']);
  });

  it('normal receipt returns every JE sharing its paymentId (N partial receipts share one)', () => {
    const jes = [
      je({ id: 'a', paymentId: 'p1' }),
      je({ id: 'b', paymentId: 'p1' }),
      je({ id: 'c', paymentId: 'p2' }),
    ];
    const out = jesForReceipt({ receiptType: 'INSTALLMENT', paymentId: 'p1' }, jes);
    expect(out.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('CREDIT_NOTE row shows the REVERSAL mirrors (matched via originalEntryId), not the money-in originals', () => {
    const jes = [
      je({ id: 'orig', paymentId: 'p1' }), // the money-in original
      je({ id: 'rev', originalEntryId: 'orig', flow: 'receipt-void' }), // its mirror
    ];
    const out = jesForReceipt({ receiptType: 'CREDIT_NOTE', paymentId: 'p1' }, jes);
    expect(out.map((j) => j.id)).toEqual(['rev']);
  });

  it('CREDIT_NOTE falls back to the originals when no reversal mirror is present', () => {
    const jes = [je({ id: 'orig', paymentId: 'p1' })];
    const out = jesForReceipt({ receiptType: 'CREDIT_NOTE', paymentId: 'p1' }, jes);
    expect(out.map((j) => j.id)).toEqual(['orig']);
  });

  it('non-early-payoff receipt with a null paymentId returns nothing', () => {
    const jes = [je({ id: 'a', paymentId: 'p1' })];
    expect(jesForReceipt({ receiptType: 'INSTALLMENT', paymentId: null }, jes)).toEqual([]);
  });
});
