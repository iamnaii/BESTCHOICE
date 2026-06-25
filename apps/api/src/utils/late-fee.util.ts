import { Prisma } from '@prisma/client';
import { BUSINESS_RULES } from './config.util';

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

export interface PerDayLateFeeInput {
  daysOverdue: number;
  perDayRate: Prisma.Decimal | number | string;
  maxAmount: Prisma.Decimal | number | string;
  capPct: Prisma.Decimal | number | string;
  /** Monthly installment incl VAT (the 5% base). */
  installmentGross: Prisma.Decimal | number | string;
}

/**
 * Per-day late fee (Section #3 / D2):
 *   0 days        → 0
 *   >= 1 day      → min(days × perDayRate, maxAmount, capPct% × installmentGross)
 * All three caps applied; the binding one wins. ROUND_HALF_UP to 2dp (matches the
 * SQL ROUND used by the overdue cron — see late-fee-perday-sql.integration.spec.ts).
 */
export function computePerDayLateFee(input: PerDayLateFeeInput): Prisma.Decimal {
  const days = Math.max(0, Math.floor(input.daysOverdue));
  if (days < 1) return new Prisma.Decimal(0);
  const byDay = new Prisma.Decimal(input.perDayRate.toString()).mul(days);
  const byMax = new Prisma.Decimal(input.maxAmount.toString());
  const byPct = new Prisma.Decimal(input.capPct.toString())
    .div(100)
    .mul(new Prisma.Decimal(input.installmentGross.toString()))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return Prisma.Decimal.min(byDay, byMax, byPct);
}

export interface LateFeeConfig {
  mode: 'BRACKET' | 'PER_DAY';
  tier1Amount: number;
  tier2Amount: number;
  tier2MinDays: number;
  perDayRate: number;
  maxAmount: number;
  capPct: number;
}

/** Read all late-fee config keys once, with BUSINESS_RULES defaults. */
export async function loadLateFeeConfig(prisma: {
  systemConfig: { findUnique: (a: { where: { key: string } }) => Promise<{ value: string } | null> };
}): Promise<LateFeeConfig> {
  const keys = [
    'late_fee_mode', 'late_fee_tier1_amount', 'late_fee_tier2_amount',
    'late_fee_tier2_min_days', 'late_fee_per_day_rate', 'late_fee_max_amount', 'late_fee_cap_pct',
  ];
  const rows = await Promise.all(keys.map((key) => prisma.systemConfig.findUnique({ where: { key } })));
  const [mode, t1, t2, minDays, rate, max, pct] = rows;
  const modeVal = mode?.value === 'BRACKET' || mode?.value === 'PER_DAY' ? mode.value : BUSINESS_RULES.LATE_FEE_MODE;
  return {
    mode: modeVal,
    tier1Amount: t1 ? Number(t1.value) : BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT,
    tier2Amount: t2 ? Number(t2.value) : BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT,
    tier2MinDays: minDays ? Number(minDays.value) : BUSINESS_RULES.LATE_FEE_TIER2_MIN_DAYS,
    perDayRate: rate ? Number(rate.value) : BUSINESS_RULES.LATE_FEE_PER_DAY_RATE,
    maxAmount: max ? Number(max.value) : BUSINESS_RULES.LATE_FEE_MAX_AMOUNT,
    capPct: pct ? Number(pct.value) : BUSINESS_RULES.LATE_FEE_CAP_PCT,
  };
}

/** Dispatch by mode. One definition consumed by every TS call site. */
export function resolveLateFee(
  cfg: LateFeeConfig,
  daysOverdue: number,
  installmentGross: Prisma.Decimal | number | string,
): Prisma.Decimal {
  if (cfg.mode === 'PER_DAY') {
    return computePerDayLateFee({
      daysOverdue,
      perDayRate: cfg.perDayRate,
      maxAmount: cfg.maxAmount,
      capPct: cfg.capPct,
      installmentGross,
    });
  }
  return computeBracketLateFee({
    daysOverdue,
    tier1Amount: cfg.tier1Amount,
    tier2Amount: cfg.tier2Amount,
    tier2MinDays: cfg.tier2MinDays,
  });
}

