import { describe, it, expect } from 'vitest';
import { computeReceiptFeeDisplay, type ReceiptFeeRow, type FeeInfo } from '../computeReceiptFeeDisplay';

const receipt = (over: Partial<ReceiptFeeRow>): ReceiptFeeRow => ({
  id: 'r',
  receiptNumber: 'RT-202607-00001',
  receiptType: 'INSTALLMENT',
  paymentId: 'pay-1',
  paidDate: '2026-07-01T03:00:00.000Z',
  isVoided: false,
  ...over,
});

describe('computeReceiptFeeDisplay', () => {
  it('puts the whole late fee on the FIRST receipt, 0 on later split receipts', () => {
    const receipts = [
      receipt({ id: 'a', receiptNumber: 'RT-202607-00003', paidDate: '2026-07-01T03:00:00.000Z' }),
      receipt({ id: 'b', receiptNumber: 'RT-202607-00004', paidDate: '2026-07-01T04:00:00.000Z' }),
    ];
    const fees = new Map<string, FeeInfo>([['pay-1', { lateFee: 100, waived: 0 }]]);
    const out = computeReceiptFeeDisplay(receipts, fees);
    expect(out.get('a')).toEqual({ lateFee: 100, waived: 0 });
    expect(out.get('b')).toEqual({ lateFee: 0, waived: 0 });
  });

  it('breaks a same-paidDate tie by the sequential receiptNumber', () => {
    const receipts = [
      receipt({ id: 'b', receiptNumber: 'RT-202607-00004' }),
      receipt({ id: 'a', receiptNumber: 'RT-202607-00003' }),
    ]; // same paidDate; 00003 must win regardless of array order
    const fees = new Map<string, FeeInfo>([['pay-1', { lateFee: 100, waived: 0 }]]);
    const out = computeReceiptFeeDisplay(receipts, fees);
    expect(out.get('a')?.lateFee).toBe(100);
    expect(out.get('b')?.lateFee).toBe(0);
  });

  it('carries the waived portion onto the first receipt too', () => {
    const receipts = [
      receipt({ id: 'a', receiptNumber: 'RT-202607-00003' }),
      receipt({ id: 'b', receiptNumber: 'RT-202607-00004', paidDate: '2026-07-01T05:00:00.000Z' }),
    ];
    const fees = new Map<string, FeeInfo>([['pay-1', { lateFee: 100, waived: 25 }]]);
    const out = computeReceiptFeeDisplay(receipts, fees);
    expect(out.get('a')).toEqual({ lateFee: 100, waived: 25 });
    expect(out.get('b')).toEqual({ lateFee: 0, waived: 0 });
  });

  it('shows 0 for every receipt when the installment has no late fee', () => {
    const receipts = [receipt({ id: 'a' }), receipt({ id: 'b', receiptNumber: 'RT-202607-00002' })];
    const fees = new Map<string, FeeInfo>([['pay-1', { lateFee: 0, waived: 0 }]]);
    const out = computeReceiptFeeDisplay(receipts, fees);
    expect(out.get('a')?.lateFee).toBe(0);
    expect(out.get('b')?.lateFee).toBe(0);
  });

  it('never attributes the fee to a voided or credit-note receipt', () => {
    const receipts = [
      receipt({ id: 'void', receiptNumber: 'RT-202607-00003', isVoided: true }),
      receipt({ id: 'cn', receiptNumber: 'RT-202607-00004', receiptType: 'CREDIT_NOTE', paidDate: '2026-07-01T05:00:00.000Z' }),
      receipt({ id: 'good', receiptNumber: 'RT-202607-00005', paidDate: '2026-07-01T06:00:00.000Z' }),
    ];
    const fees = new Map<string, FeeInfo>([['pay-1', { lateFee: 100, waived: 0 }]]);
    const out = computeReceiptFeeDisplay(receipts, fees);
    expect(out.get('void')?.lateFee).toBe(0);
    expect(out.get('cn')?.lateFee).toBe(0);
    expect(out.get('good')?.lateFee).toBe(100);
  });

  it('never attributes the installment-level fee to a RESCHEDULE_FEE receipt', () => {
    const receipts = [
      receipt({ id: 'rf', receiptNumber: 'RT-202607-00003', receiptType: 'RESCHEDULE_FEE' }),
      receipt({ id: 'good', receiptNumber: 'RT-202607-00004', paidDate: '2026-07-01T05:00:00.000Z' }),
    ];
    const fees = new Map<string, FeeInfo>([['pay-1', { lateFee: 100, waived: 0 }]]);
    const out = computeReceiptFeeDisplay(receipts, fees);
    expect(out.get('rf')?.lateFee).toBe(0);
    expect(out.get('good')?.lateFee).toBe(100);
  });

  it('shows the reschedule receipt own collected fee, separate from the last-installment advance', () => {
    const out = computeReceiptFeeDisplay([
      receipt({ id: 'reschedule', receiptType: 'RESCHEDULE_FEE', lateFeeCollected: '100.00', lateFeeWaivedThisReceipt: '0.00' }),
    ], new Map([['pay-1', { lateFee: 0, waived: 0 }]]));
    expect(out.get('reschedule')).toEqual({ lateFee: 100, waived: 0 });
  });

  it('attributes each installment its own first-receipt fee', () => {
    const receipts = [
      receipt({ id: 'a1', paymentId: 'pay-1', receiptNumber: 'RT-202607-00001' }),
      receipt({ id: 'a2', paymentId: 'pay-1', receiptNumber: 'RT-202607-00002', paidDate: '2026-07-01T05:00:00.000Z' }),
      receipt({ id: 'b1', paymentId: 'pay-2', receiptNumber: 'RT-202608-00001', paidDate: '2026-08-01T03:00:00.000Z' }),
    ];
    const fees = new Map<string, FeeInfo>([
      ['pay-1', { lateFee: 100, waived: 0 }],
      ['pay-2', { lateFee: 50, waived: 0 }],
    ]);
    const out = computeReceiptFeeDisplay(receipts, fees);
    expect(out.get('a1')?.lateFee).toBe(100);
    expect(out.get('a2')?.lateFee).toBe(0);
    expect(out.get('b1')?.lateFee).toBe(50);
  });
  it('keeps first fee 100 and a manually added second fee 50 on their own receipts', () => {
    const rows = [
      receipt({ id: 'first', lateFeeCollected: '100.00', lateFeeWaivedThisReceipt: '0.00' }),
      receipt({ id: 'second', receiptNumber: 'RT-202607-00002', lateFeeCollected: '50.00', lateFeeWaivedThisReceipt: '0.00' }),
      receipt({ id: 'third', receiptNumber: 'RT-202607-00003', lateFeeCollected: '0.00', lateFeeWaivedThisReceipt: '0.00' }),
    ];
    const out = computeReceiptFeeDisplay(rows, new Map([['pay-1', { lateFee: 150, waived: 0 }]]));
    expect(out.get('first')).toEqual({ lateFee: 100, waived: 0 });
    expect(out.get('second')).toEqual({ lateFee: 50, waived: 0 });
    expect(out.get('third')).toEqual({ lateFee: 0, waived: 0 });
  });

  it('adds only this receipt waiver back to collected cash to display the gross fee', () => {
    const out = computeReceiptFeeDisplay([
      receipt({ id: 'first', lateFeeCollected: '70.00', lateFeeWaivedThisReceipt: '30.00' }),
    ], new Map([['pay-1', { lateFee: 999, waived: 999 }]]));
    expect(out.get('first')).toEqual({ lateFee: 100, waived: 30 });
  });

  it('does not guess the fee of an ambiguous receipt when a sibling has authoritative data', () => {
    const out = computeReceiptFeeDisplay([
      receipt({ id: 'old', lateFeeCollected: null, lateFeeWaivedThisReceipt: null }),
      receipt({ id: 'new', receiptNumber: 'RT-202607-00002', lateFeeCollected: '50.00', lateFeeWaivedThisReceipt: '0.00' }),
    ], new Map([['pay-1', { lateFee: 150, waived: 0 }]]));
    expect(out.get('old')).toEqual({ lateFee: 0, waived: 0, unavailable: true });
    expect(out.get('new')).toEqual({ lateFee: 50, waived: 0 });
  });

  it('honors authoritative history outside the loaded page, including a known zero fee', () => {
    const out = computeReceiptFeeDisplay([
      receipt({ id: 'old', lateFeeCollected: null, lateFeeWaivedThisReceipt: null, hasReceiptFeeHistory: true }),
    ], new Map([['pay-1', { lateFee: 150, waived: 0 }]]));
    expect(out.get('old')?.unavailable).toBe(true);
    const zero = computeReceiptFeeDisplay([
      receipt({ id: 'zero', lateFeeCollected: '0.00', lateFeeWaivedThisReceipt: '0.00' }),
    ], new Map([['pay-1', { lateFee: 100, waived: 0 }]]));
    expect(zero.get('zero')).toEqual({ lateFee: 0, waived: 0 });
  });

  it('keeps voided and non-payment receipts at zero even when fee fields are present', () => {
    const out = computeReceiptFeeDisplay([
      receipt({ id: 'voided', isVoided: true, lateFeeCollected: '100.00', lateFeeWaivedThisReceipt: '0.00' }),
      receipt({ id: 'cn', receiptType: 'CREDIT_NOTE', lateFeeCollected: '100.00', lateFeeWaivedThisReceipt: '0.00' }),
    ], new Map());
    expect(out.get('voided')).toEqual({ lateFee: 0, waived: 0 });
    expect(out.get('cn')).toEqual({ lateFee: 0, waived: 0 });
  });

});
