/**
 * Shared system config loading utilities
 * Eliminates duplication of config loading pattern across services
 */
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_VAT_DECIMAL, parseVatValue } from './vat-rate.util';

/**
 * Minimal shape of a Prisma-compatible client for SystemConfig reads.
 *
 * Accepts both `PrismaService` and `Prisma.TransactionClient` so that
 * transaction-scoped reads (`tx.systemConfig.findFirst`) and request-scoped
 * reads (`this.prisma.systemConfig.findFirst`) share the same util.
 */
type SystemConfigReader = {
  systemConfig: {
    findFirst: (args: {
      where: { key: string; deletedAt: null };
      select: { value: true };
    }) => Promise<{ value: string | null } | null>;
  };
};

/**
 * Read a single `SystemConfig.value` by key. Returns `null` when the row is
 * missing or has been soft-deleted. Defensive try/catch — any DB error
 * (connection blip, query timeout) is swallowed and returns `null` so the
 * caller can fall through to its default. SystemConfig is "best effort"
 * runtime config; first-boot behaviour must always succeed without a row.
 */
async function readRawValue(
  prisma: SystemConfigReader,
  key: string,
): Promise<string | null> {
  try {
    const row = await prisma.systemConfig.findFirst({
      where: { key, deletedAt: null },
      select: { value: true },
    });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Read a boolean SystemConfig flag with fallback.
 *
 * Recognises `true`/`false` (case-insensitive) and `1`/`0`. Any other value
 * (including null/missing key) yields the `fallback`. Whitespace is trimmed.
 *
 * Example: `readBoolFlag(prisma, 'reverse_block_cascaded', true)`
 */
export async function readBoolFlag(
  prisma: SystemConfigReader,
  key: string,
  fallback: boolean,
): Promise<boolean> {
  const raw = await readRawValue(prisma, key);
  if (raw == null) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
}

/**
 * Read a numeric SystemConfig flag with fallback. Uses `Number(...)` parsing —
 * accepts integers, decimals, and negative numbers. NaN / Infinity values
 * fall back to the default. Whitespace tolerated.
 *
 * Example: `readNumberFlag(prisma, 'late_fee_per_day', 100)`
 */
export async function readNumberFlag(
  prisma: SystemConfigReader,
  key: string,
  fallback: number,
): Promise<number> {
  const raw = await readRawValue(prisma, key);
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  // Empty string would parse to `0` via Number('') — treat as unset instead.
  if (trimmed.length === 0) return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read a string SystemConfig flag with fallback. Returns the raw string
 * value (no parsing). Empty string → fallback (treat "" as unset).
 *
 * Example: `readStringFlag(prisma, 'bank_name', 'KBank')`
 */
export async function readStringFlag(
  prisma: SystemConfigReader,
  key: string,
  fallback: string,
): Promise<string> {
  const raw = await readRawValue(prisma, key);
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

/**
 * Read a JSON-encoded SystemConfig flag with fallback. Caller supplies a
 * validator predicate that confirms the parsed value matches the expected
 * shape — if `JSON.parse` throws OR the validator returns false, fallback
 * is used. Prevents malformed JSON from breaking runtime callers.
 *
 * Example:
 * ```
 * const reasons = await readJsonFlag(
 *   prisma,
 *   'reverse_reasons',
 *   defaults,
 *   (v): v is { code: string; label: string }[] =>
 *     Array.isArray(v) && v.every((r) => typeof r.code === 'string'),
 * );
 * ```
 */
export async function readJsonFlag<T>(
  prisma: SystemConfigReader,
  key: string,
  fallback: T,
  validator?: (value: unknown) => value is T,
): Promise<T> {
  const raw = await readRawValue(prisma, key);
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (validator && !validator(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

const INSTALLMENT_CONFIG_KEYS = [
  'interest_rate',
  'min_down_payment_pct',
  'min_installment_months',
  'max_installment_months',
  'store_commission_pct',
  // D1.1.3.1 — VAT rate now lives under canonical `VAT_RATE` (percentage form)
  // with `vat_pct` retained as a legacy fallback. Both are fetched here; the
  // resolution helper below picks the first one that parses.
  'VAT_RATE',
  'vat_pct',
  'vat_rate',
] as const;

export interface InstallmentConfig {
  interestRate: number;
  minDownPaymentPct: number;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
  storeCommissionPct: number;
  vatPct: number;
}

const DEFAULTS: InstallmentConfig = {
  interestRate: 0.08,
  minDownPaymentPct: 0.15,
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  storeCommissionPct: 0.10,
  vatPct: 0.07,
};

/**
 * INVENTORY COSTING METHOD: Specific Identification
 * Each product has a unique costPrice (IMEI-level tracking).
 * COGS is calculated as the specific costPrice of the sold product.
 * This is compliant with TAS 2 for items that are not interchangeable.
 */
export const INVENTORY_COSTING_METHOD = 'SPECIFIC_IDENTIFICATION' as const;

/** Business rule constants for overdue and early payoff */
export const BUSINESS_RULES = {
  LATE_FEE_PER_DAY: 100,    // baht per day overdue
  LATE_FEE_CAP: 200,         // max late fee per installment (baht) — actual cap = min(this, amountDue * LATE_FEE_CAP_PCT)
  LATE_FEE_CAP_PCT: 0.05,   // max 5% of installment amount per Thai law
  EARLY_PAYOFF_DISCOUNT: 0.5, // 50% discount on remaining interest
  /**
   * Escalation Guardrail: เมื่อลูกค้าผิดนัด ≥ N ครั้ง บนสัญญาเดียวกัน
   * → block "นัดใหม่" (PROMISED outcome) ใน logContact
   * → บังคับ collector ทำ escalation (LETTER / MDM / LEGAL)
   * Count = AuditLog rows ที่ action='BROKEN_PROMISE' บน contract นั้น (lifetime, ไม่ reset)
   */
  ESCALATION_BROKEN_PROMISE_THRESHOLD: 2,
} as const;

/**
 * Load installment-related system configs with defaults
 */
export async function loadInstallmentConfig(
  prisma: PrismaService | { systemConfig: { findMany: (...args: unknown[]) => Promise<{ key: string; value: string }[]> } },
): Promise<InstallmentConfig> {
  const configs = await prisma.systemConfig.findMany({
    where: { key: { in: [...INSTALLMENT_CONFIG_KEYS] }, deletedAt: null },
  });

  const getValue = (key: string, def: number): number => {
    const raw = parseFloat(configs.find((c: { key: string; value: string }) => c.key === key)?.value || String(def));
    return Math.round(raw * 10000) / 10000; // Round to 4 decimal places for rate precision
  };

  // D1.1.3.1 — Resolve VAT rate with the canonical-key-first fallback chain.
  // VAT_RATE (percent) → vat_pct (decimal) → vat_rate (decimal) → default.
  const resolveVatPct = (): number => {
    for (const k of ['VAT_RATE', 'vat_pct', 'vat_rate']) {
      const row = configs.find((c) => c.key === k);
      const parsed = parseVatValue(row?.value);
      if (parsed != null) return Math.round(parsed * 10000) / 10000;
    }
    return DEFAULT_VAT_DECIMAL;
  };

  return {
    interestRate: getValue('interest_rate', DEFAULTS.interestRate),
    minDownPaymentPct: getValue('min_down_payment_pct', DEFAULTS.minDownPaymentPct),
    minInstallmentMonths: getValue('min_installment_months', DEFAULTS.minInstallmentMonths),
    maxInstallmentMonths: getValue('max_installment_months', DEFAULTS.maxInstallmentMonths),
    storeCommissionPct: getValue('store_commission_pct', DEFAULTS.storeCommissionPct),
    vatPct: resolveVatPct(),
  };
}

/**
 * Resolve installment config: prefer InterestConfig entity, fallback to system config
 */
export function resolveInstallmentParams(
  interestConfig: { interestRate: { toString(): string }; minDownPaymentPct: { toString(): string }; storeCommissionPct?: { toString(): string } | null; vatPct?: { toString(): string } | null; minInstallmentMonths: number; maxInstallmentMonths: number } | null,
  systemConfig: InstallmentConfig,
  overrideInterestRate?: number | null,
): {
  interestRate: number;
  minDownPaymentPct: number;
  storeCommissionPct: number;
  vatPct: number;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
} {
  return {
    interestRate: overrideInterestRate ?? (interestConfig ? Number(interestConfig.interestRate) : systemConfig.interestRate),
    minDownPaymentPct: interestConfig ? Number(interestConfig.minDownPaymentPct) : systemConfig.minDownPaymentPct,
    storeCommissionPct: interestConfig?.storeCommissionPct != null ? Number(interestConfig.storeCommissionPct) : systemConfig.storeCommissionPct,
    vatPct: interestConfig?.vatPct != null ? Number(interestConfig.vatPct) : systemConfig.vatPct,
    minInstallmentMonths: interestConfig ? interestConfig.minInstallmentMonths : systemConfig.minInstallmentMonths,
    maxInstallmentMonths: interestConfig ? interestConfig.maxInstallmentMonths : systemConfig.maxInstallmentMonths,
  };
}

/**
 * Resolve the effective VAT rate for a branch.
 *
 * Business rule:
 *   - BESTCHOICE SHOP  (vatRegistered=false) → 0% VAT
 *   - BESTCHOICE FINANCE (vatRegistered=true)  → company.vatRate (default 7%)
 *
 * Falls back to `defaultVatPct` when no branchId is supplied or the branch
 * record cannot be found (e.g. during seeding or unit tests).
 */
export async function resolveVatPctForBranch(
  prisma: PrismaService | { branch: { findUnique: (...args: unknown[]) => Promise<unknown> } },
  branchId: string | null | undefined,
  defaultVatPct: number,
): Promise<number> {
  if (!branchId) return defaultVatPct;

  const branch = await (prisma as PrismaService).branch.findUnique({
    where: { id: branchId },
    include: { company: { select: { vatRegistered: true, vatRate: true } } },
  });

  if (!branch?.company) return defaultVatPct;
  if (!branch.company.vatRegistered) return 0;
  if (branch.company.vatRate != null) return Number(branch.company.vatRate);
  return defaultVatPct;
}
