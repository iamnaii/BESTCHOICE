import { Prisma } from '@prisma/client';

export interface BracketLateFeeInput {
  /** Days past due (floored, clamped to >= 0 internally). */
  daysOverdue: number;
  /** Flat fee for 1..(tier2MinDays-1) days overdue (config `late_fee_tier1_amount`). */
  tier1Amount: Prisma.Decimal | number | string;
  /** Flat fee for >= tier2MinDays days overdue (config `late_fee_tier2_amount`). */
  tier2Amount: Prisma.Decimal | number | string;
  /** Day at which tier2 begins (config `late_fee_tier2_min_days`, default 3). */
  tier2MinDays: number;
}

/**
 * Flat-bracket late fee (CPA CSV / owner decision 2026-06-25):
 *   0 days        → 0
 *   1..(min-1)    → tier1Amount   (e.g. 50฿)
 *   >= min        → tier2Amount   (e.g. 100฿, flat — does NOT accumulate per day)
 *
 * NOTE: The previous per-day model AND the 5% Thai-law per-installment cap
 * (LATE_FEE_CAP_PCT) were intentionally REMOVED by owner decision 2026-06-25.
 * Late fee is now a flat bracket only, config-driven (reversible). CPA to review
 * compliance before production rollout. Single source of truth — the collection
 * path (recordPayment), the overdue cron (raw SQL), and the LIFF chatbot quote
 * MUST all resolve the same brackets so quotes match charges.
 */
export function computeBracketLateFee(input: BracketLateFeeInput): Prisma.Decimal {
  const days = Math.max(0, Math.floor(input.daysOverdue));
  if (days <= 0) return new Prisma.Decimal(0);
  if (days >= input.tier2MinDays) return new Prisma.Decimal(input.tier2Amount.toString());
  return new Prisma.Decimal(input.tier1Amount.toString());
}

// ---------------------------------------------------------------------------
// DEPRECATED — removed in D2 task 4 after all callers migrate
// ---------------------------------------------------------------------------

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
 * @deprecated Use computeBracketLateFee instead. Removed in D2 task 4.
 *
 * Canonical real-time late fee:
 *   round2( min( feePerDay × daysOverdue, flatCap, amountDue × capPct ) )
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
