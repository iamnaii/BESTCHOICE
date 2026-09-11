import { Prisma } from '@prisma/client';

export const bookingReceiptSelect = {
  id: true, bookingNumber: true, depositAmount: true, depositMethod: true,
  depositPaidAt: true, convertedAt: true,
} satisfies Prisma.BookingSelect;

type BookingReceipt = Prisma.BookingGetPayload<{ select: typeof bookingReceiptSelect }>;

/** Derive a split only when the recorded amounts and receipt evidence agree. */
export function bookingReceipt(sale: {
  booking?: BookingReceipt | null; amountReceived: Prisma.Decimal | null;
  downPaymentAmount: Prisma.Decimal | null; netAmount: Prisma.Decimal; paymentMethod: string | null;
}) {
  const booking = sale.booking;
  if (!booking) return null;
  const deposit = new Prisma.Decimal(booking.depositAmount);
  const total = new Prisma.Decimal(sale.netAmount);
  const received = sale.amountReceived == null ? null : new Prisma.Decimal(sale.amountReceived);
  const methods = ['CASH', 'BANK_TRANSFER', 'QR_EWALLET'];
  const depositConfirmed = !!booking.depositPaidAt && methods.includes(booking.depositMethod ?? '') && deposit.gte(0);
  const complete = depositConfirmed && !!booking.convertedAt
    && deposit.gte(0) && deposit.lte(total) && received?.eq(total)
    && sale.downPaymentAmount != null && deposit.eq(sale.downPaymentAmount)
    && (deposit.eq(total) || methods.includes(sale.paymentMethod ?? ''));
  return {
    bookingId: booking.id, bookingNumber: booking.bookingNumber,
    depositAmount: depositConfirmed ? deposit.toFixed(2) : null, depositMethod: booking.depositMethod, depositPaidAt: booking.depositPaidAt,
    additionalAmount: complete ? total.minus(deposit).toFixed(2) : null,
    additionalMethod: complete && deposit.lt(total) ? sale.paymentMethod : null,
    convertedAt: booking.convertedAt, totalReceived: complete ? received!.toFixed(2) : null,
    needsReview: !complete,
  };
}
