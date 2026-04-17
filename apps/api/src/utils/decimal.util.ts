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

// ---------------------------------------------------------------------------
// Safe Decimal arithmetic helpers — use these instead of Number() on Decimal
// fields to avoid floating-point precision errors in financial calculations.
// ---------------------------------------------------------------------------

type DecimalInput = Prisma.Decimal | string | number | null | undefined;

/** Convert any value to Prisma.Decimal (null/undefined → 0) */
export function d(val: DecimalInput): Prisma.Decimal {
  if (val === null || val === undefined) return new Prisma.Decimal(0);
  if (val instanceof Prisma.Decimal) return val;
  return new Prisma.Decimal(val);
}

export function dAdd(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
  return d(a).add(d(b));
}

export function dSub(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
  return d(a).sub(d(b));
}

export function dMul(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
  return d(a).mul(d(b));
}

export function dDiv(a: DecimalInput, b: DecimalInput): Prisma.Decimal {
  return d(a).div(d(b));
}

export function dSum(vals: DecimalInput[]): Prisma.Decimal {
  return vals.reduce<Prisma.Decimal>((acc, v) => acc.add(d(v)), new Prisma.Decimal(0));
}

export function dGte(a: DecimalInput, b: DecimalInput): boolean {
  return d(a).gte(d(b));
}

export function dAbs(a: DecimalInput): Prisma.Decimal {
  return d(a).abs();
}

/** Round to 2 decimal places (satang precision) */
export function dRound(a: DecimalInput): Prisma.Decimal {
  return d(a).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function dCompare(a: DecimalInput, b: DecimalInput): -1 | 0 | 1 {
  return d(a).cmp(d(b)) as -1 | 0 | 1;
}

/** Check if two Decimals are within tolerance (default 0.01 baht) */
export function dClose(a: DecimalInput, b: DecimalInput, tolerance = '0.01'): boolean {
  return dAbs(dSub(a, b)).lte(new Prisma.Decimal(tolerance));
}
