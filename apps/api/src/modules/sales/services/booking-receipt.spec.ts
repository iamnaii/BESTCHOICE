import { Prisma } from '@prisma/client';
import { bookingReceipt } from './booking-receipt';
const d = (value: number) => new Prisma.Decimal(value);
const input = () => ({ amountReceived: d(10000), downPaymentAmount: d(1000), netAmount: d(10000), paymentMethod: 'BANK_TRANSFER',
  booking: { id: 'booking', bookingNumber: 'BK-1', depositAmount: d(1000), depositMethod: 'CASH' as const,
    depositPaidAt: new Date('2026-09-01T00:00:00Z'), convertedAt: new Date('2026-09-02T00:00:00Z') } });

describe('booking receipt evidence', () => {
  it('separates a cash deposit from a bank balance', () => {
    expect(bookingReceipt(input())).toMatchObject({ depositAmount: '1000.00', depositMethod: 'CASH',
      additionalAmount: '9000.00', additionalMethod: 'BANK_TRANSFER', totalReceived: '10000.00', needsReview: false });
  });
  it('shows zero additional payment for full prepayment', () => {
    const sale = input(); sale.booking.depositAmount = d(10000); sale.downPaymentAmount = d(10000);
    expect(bookingReceipt(sale)).toMatchObject({ additionalAmount: '0.00', additionalMethod: null, needsReview: false });
  });
  it.each(['amountReceived', 'downPaymentAmount'] as const)('does not infer receipt from missing %s', field => {
    expect(bookingReceipt({ ...input(), [field]: null })).toMatchObject({ additionalAmount: null, totalReceived: null, needsReview: true });
  });
  it('does not infer legacy missing method or mismatched receipts', () => {
    const sale = input();
    expect(bookingReceipt({ ...sale, booking: { ...sale.booking, depositMethod: null } })).toMatchObject({ needsReview: true, depositAmount: null });
    expect(bookingReceipt({ ...sale, amountReceived: d(9000) })?.needsReview).toBe(true);
  });
  it('returns no booking section for regular sales', () => { expect(bookingReceipt({ ...input(), booking: null })).toBeNull(); });
});
