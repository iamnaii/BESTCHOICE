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
 * Flat-bracket late fee:
 *   0 days        → 0
 *   1..(min-1)    → tier1Amount   (e.g. 50฿)
 *   >= min        → tier2Amount   (e.g. 100฿, flat — does NOT accumulate per day)
 *
 * CPA ยืนยันขั้นบันไดถาวร 2026-08-01 — this is the ONLY late-fee formula in the
 * system. (The per-day model + 5% cap that briefly lived alongside this as a
 * config-switchable `late_fee_mode='PER_DAY'` path was removed the same day —
 * it was CPA-gated and never actually ran on prod, which always seeded
 * `late_fee_mode=BRACKET`.) Single source of truth — recordPayment, the
 * overdue cron (raw SQL), and the LIFF chatbot quotes all resolve through
 * `resolveLateFee` so quotes match charges.
 */
export function computeBracketLateFee(input: BracketLateFeeInput): Prisma.Decimal {
  const days = Math.max(0, Math.floor(input.daysOverdue));
  if (days <= 0) return new Prisma.Decimal(0);
  if (days >= input.tier2MinDays) return new Prisma.Decimal(input.tier2Amount.toString());
  return new Prisma.Decimal(input.tier1Amount.toString());
}

export interface LateFeeConfig {
  tier1Amount: number;
  tier2Amount: number;
  tier2MinDays: number;
}

/** Read the late-fee bracket config keys once, with BUSINESS_RULES defaults. */
export async function loadLateFeeConfig(prisma: {
  systemConfig: { findUnique: (a: { where: { key: string } }) => Promise<{ value: string } | null> };
}): Promise<LateFeeConfig> {
  const keys = ['late_fee_tier1_amount', 'late_fee_tier2_amount', 'late_fee_tier2_min_days'];
  const rows = await Promise.all(keys.map((key) => prisma.systemConfig.findUnique({ where: { key } })));
  const [t1, t2, minDays] = rows;
  return {
    tier1Amount: t1 ? Number(t1.value) : BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT,
    tier2Amount: t2 ? Number(t2.value) : BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT,
    tier2MinDays: minDays ? Number(minDays.value) : BUSINESS_RULES.LATE_FEE_TIER2_MIN_DAYS,
  };
}

/** Thin wrapper over computeBracketLateFee — kept so call sites don't need to
 * import computeBracketLateFee directly and to preserve a single dispatch
 * point (historically this dispatched by `late_fee_mode`; BRACKET is now the
 * only branch, CPA ยืนยันขั้นบันไดถาวร 2026-08-01). */
export function resolveLateFee(cfg: LateFeeConfig, daysOverdue: number): Prisma.Decimal {
  return computeBracketLateFee({
    daysOverdue,
    tier1Amount: cfg.tier1Amount,
    tier2Amount: cfg.tier2Amount,
    tier2MinDays: cfg.tier2MinDays,
  });
}

/**
 * Display-side live late fee for an UNPAID installment as of `asOf`. The twin of
 * the record-time recompute in PaymentReceiptOrchestrator — call this wherever a
 * pending/overdue installment's late fee is SHOWN, so the figure tracks the
 * current config instead of the stored `Payment.lateFee` stamp (refreshed only at
 * record time / by the overdue cron).
 *
 *   waived                    → 0
 *   dueDate >= asOf (≥ today) → 0  (resolveLateFee returns 0 for < 1 whole day)
 *   otherwise                 → resolveLateFee(cfg, whole days overdue)
 *
 * Do NOT use this for PAID installments: their stored lateFee is the actual charge.
 */
export function resolveLivePaymentLateFee(
  payment: { dueDate: Date; amountDue: Prisma.Decimal | number | string; lateFeeWaived: boolean },
  cfg: LateFeeConfig,
  asOf: Date,
): Prisma.Decimal {
  if (payment.lateFeeWaived) return new Prisma.Decimal(0);
  const daysOverdue = Math.max(
    0,
    Math.floor((asOf.getTime() - new Date(payment.dueDate).getTime()) / 86_400_000),
  );
  return resolveLateFee(cfg, daysOverdue);
}
