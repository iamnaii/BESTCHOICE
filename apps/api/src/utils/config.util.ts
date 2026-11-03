/**
 * Shared system config loading utilities
 * Eliminates duplication of config loading pattern across services
 */
import { Prisma } from '@prisma/client';
import { DEFAULT_VAT_DECIMAL, parseVatValue } from './vat-rate.util';
import { STORE_COMMISSION_FALLBACK_RATE } from './store-commission.util';

/**
 * Minimal shape of a Prisma-compatible client for SystemConfig reads.
 *
 * Accepts both `PrismaService` and `Prisma.TransactionClient` so that
 * transaction-scoped reads (`tx.systemConfig.findFirst`) and request-scoped
 * reads (`this.prisma.systemConfig.findFirst`) share the same util.
 */
export type SystemConfigReader = {
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
  return parseBooleanFlag(raw, fallback);
}

/** Same flag grammar for already-loaded rows, without swallowing database errors. */
export function parseBooleanFlag(raw: string | null | undefined, fallback: boolean): boolean {
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
 * Example: `readNumberFlag(prisma, 'late_fee_tier1_amount', 50)`
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
 * Read an integer SystemConfig flag with fallback + [min,max] clamp. Non-integer,
 * out-of-range, empty, missing, or DB-error all yield the fallback. (No trim — matches
 * the original Number(value) parse.)
 */
export async function readIntFlag(
  prisma: SystemConfigReader,
  key: string,
  fallback: number,
  min: number,
  max: number,
): Promise<number> {
  const raw = await readRawValue(prisma, key);
  if (!raw) return fallback; // matches original `!row?.value` (null AND '' → fallback)
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
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
  // แหล่งเดียวกับ fallback ของ resolveStoreCommission — เลื่อนออกจากกันไม่ได้
  storeCommissionPct: Number(STORE_COMMISSION_FALLBACK_RATE),
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
  LATE_FEE_TIER1_AMOUNT: 50,   // flat fee, 1..(min-1) days overdue (baht)
  LATE_FEE_TIER2_AMOUNT: 100,  // flat fee, >= LATE_FEE_TIER2_MIN_DAYS days overdue (baht)
  LATE_FEE_TIER2_MIN_DAYS: 3,  // day at which tier2 begins
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
  prisma: Pick<Prisma.TransactionClient, 'systemConfig'>,
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
 * VAT ของสัญญาผ่อน — อ่านจาก**บริษัทผู้ให้สินเชื่อ FINANCE** (`company_info.company_code = 'FINANCE'` ที่ยังไม่ถูกลบ — แถวเดียวกับที่
 * `CompanyResolverService.getFinanceCompanyId` และด่านงวดของ 2A ใช้) ไม่ใช่บริษัทของสาขา (2026-10-31 · impact C1 ของการตั้ง
 * `branches.company_id = SHOP`): สัญญาผ่อนเป็นของ FINANCE ไม่ว่าทำที่สาขาไหน — สาขาหน้าร้านผูก SHOP ซึ่งไม่จด VAT ⇒ เดิมสัญญาใหม่ของ
 * สาขานั้นจะได้ VAT 0
 *
 *   - FINANCE ไม่จด VAT → 0 · มี `vatRate` → อัตรานั้น
 *   - ไม่มีแถว FINANCE หรือไม่มีอัตรา → `defaultVatPct` (interest config / system config — ลำดับเดิม)
 *
 * (เดิม `resolveBranchVat` / `resolveVatPctForBranch` อ่านบริษัทของสาขา — ผู้เรียกในโค้ดจริงมีแค่ใบเสนอยอดสัญญาผ่อน ซึ่งเป็นของ FINANCE
 * ⇒ ถอดทั้งคู่ · การขายหน้าร้าน (SHOP) ไม่ได้คิด VAT ผ่านตัวนี้)
 */
export async function resolveFinanceVat(
  prisma: Pick<Prisma.TransactionClient, 'companyInfo'>,
  defaultVatPct: number,
): Promise<{ vatPct: number; source: 'FINANCE_COMPANY' | 'CONFIG_FALLBACK' }> {
  const fallback = { vatPct: defaultVatPct, source: 'CONFIG_FALLBACK' as const };
  const finance = await prisma.companyInfo.findFirst({
    where: { companyCode: 'FINANCE', deletedAt: null },
    select: { vatRegistered: true, vatRate: true },
  });
  if (!finance) return fallback;
  if (!finance.vatRegistered) return { vatPct: 0, source: 'FINANCE_COMPANY' };
  if (finance.vatRate != null)
    return { vatPct: Number(finance.vatRate), source: 'FINANCE_COMPANY' };
  return fallback;
}
