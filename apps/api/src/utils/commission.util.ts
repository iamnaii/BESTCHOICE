import { Prisma } from '@prisma/client';

type DecimalInput = Prisma.Decimal | number | string;

/**
 * Sales commission = saleAmount × rate, rounded to 2 decimal places ROUND_HALF_UP.
 *
 * Uses Prisma.Decimal end-to-end. The previous `Math.round(saleAmount * rate * 100) / 100`
 * dropped a satang whenever the exact product landed on a half-satang the float
 * representation undershot (e.g. 5.50 × 0.03 = 0.165 → float 0.16, correct 0.17),
 * systematically under/over-paying staff over many sales.
 */
export function computeCommissionAmount(
  saleAmount: DecimalInput,
  rate: DecimalInput,
): Prisma.Decimal {
  return new Prisma.Decimal(saleAmount)
    .mul(new Prisma.Decimal(rate))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
