import { Prisma } from '@prisma/client';

/**
 * Convert a Prisma Decimal field to a JS number.
 * Prisma returns Decimal fields as Prisma.Decimal instances —
 * this safely calls .toNumber() on them.
 */
export function toNum(value: unknown): number {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return new Prisma.Decimal(value as string).toNumber();
}

/**
 * Calculate outstanding amount (amountDue + lateFee - amountPaid) using Decimal arithmetic.
 * Accepts a single payment or array of payments.
 */
export function calcOutstanding(
  payments: { amountDue: unknown; lateFee: unknown; amountPaid: unknown }
    | Array<{ amountDue: unknown; lateFee: unknown; amountPaid: unknown }>,
): number {
  const arr = Array.isArray(payments) ? payments : [payments];
  return arr.reduce(
    (sum, p) => sum
      .add(new Prisma.Decimal(p.amountDue as string))
      .add(new Prisma.Decimal(p.lateFee as string))
      .sub(new Prisma.Decimal(p.amountPaid as string)),
    new Prisma.Decimal(0),
  ).toNumber();
}
