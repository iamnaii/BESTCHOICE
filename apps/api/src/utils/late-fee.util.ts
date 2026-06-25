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

