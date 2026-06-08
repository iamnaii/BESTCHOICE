import { Prisma } from '@prisma/client';

export interface CappedLateFeeInput {
  /** Days past due (floored, clamped to >= 0 internally). */
  daysOverdue: number;
  /** Per-day late fee (config `late_fee_per_day`). */
  feePerDay: Prisma.Decimal | number | string;
  /** Flat per-installment ceiling (config `late_fee_cap`). */
  flatCap: Prisma.Decimal | number | string;
  /** Per-installment percentage cap, e.g. 0.05 = 5% (BUSINESS_RULES.LATE_FEE_CAP_PCT).
   *  Applied ONLY when amountDue is provided. */
  capPct?: number;
  /** The installment's amountDue — enables the percentage cap. Omit for a generic
   *  estimate with no installment context (then only feePerDay×days + flatCap bound it). */
  amountDue?: Prisma.Decimal | number | string | null;
}

/**
 * Canonical real-time late fee:
 *   round2( min( feePerDay × daysOverdue, flatCap, amountDue × capPct ) )
 *
 * Single source of truth for the per-installment late-fee ceiling. Mirrors the
 * collection path in payments.service.recordPayment (and the overdue.service
 * `calculateLateFees` raw-SQL). The LIFF chatbot (finance-tools) MUST use this so
 * its quote matches what the customer is actually charged — previously the bot
 * quoted an UNCAPPED daysOverdue×rate, over-stating the fine (e.g. 3,000 quoted
 * vs 100 charged on a 2,000฿ / 60-day installment).
 *
 * When amountDue is omitted (a hypothetical "X days overdue" estimate with no
 * installment), the percentage cap can't apply, so only feePerDay×days + flatCap
 * bound the result — callers should make clear it's an upper-bound estimate.
 */
export function computeCappedLateFee(input: CappedLateFeeInput): Prisma.Decimal {
  const days = Math.max(0, Math.floor(input.daysOverdue));
  if (days <= 0) return new Prisma.Decimal(0);

  const perDayTotal = new Prisma.Decimal(input.feePerDay.toString()).mul(days);
  const caps: Prisma.Decimal[] = [perDayTotal, new Prisma.Decimal(input.flatCap.toString())];

  if (input.amountDue != null && input.capPct != null) {
    caps.push(new Prisma.Decimal(input.amountDue.toString()).mul(input.capPct));
  }

  return Prisma.Decimal.min(...caps).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
