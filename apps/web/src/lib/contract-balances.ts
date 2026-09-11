import Decimal from 'decimal.js';
import { calendarDaysSince } from './date';

export function contractBalances(status: string, payments: {
  status: string; amountDue: string; amountPaid?: string | null; lateFee?: string | null; dueDate: string;
}[], now = new Date()) {
  let outstanding = new Decimal(0), overdue = new Decimal(0);
  for (const payment of payments) {
    if (payment.status === 'PAID') continue;
    const remaining = Decimal.max(0, new Decimal(payment.amountDue).plus(payment.lateFee || 0).minus(payment.amountPaid || 0));
    outstanding = outstanding.plus(remaining);
    if (status !== 'DRAFT' && (calendarDaysSince(payment.dueDate, now, 'Asia/Bangkok') ?? 0) > 0) overdue = overdue.plus(remaining);
  }
  return { outstanding: outstanding.toNumber(), overdue: overdue.toNumber() };
}
