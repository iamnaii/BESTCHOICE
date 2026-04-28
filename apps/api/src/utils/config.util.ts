/**
 * Shared system config loading utilities
 * Eliminates duplication of config loading pattern across services
 */
import { PrismaService } from '../prisma/prisma.service';

const INSTALLMENT_CONFIG_KEYS = [
  'interest_rate',
  'min_down_payment_pct',
  'min_installment_months',
  'max_installment_months',
  'store_commission_pct',
  'vat_pct',
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

  return {
    interestRate: getValue('interest_rate', DEFAULTS.interestRate),
    minDownPaymentPct: getValue('min_down_payment_pct', DEFAULTS.minDownPaymentPct),
    minInstallmentMonths: getValue('min_installment_months', DEFAULTS.minInstallmentMonths),
    maxInstallmentMonths: getValue('max_installment_months', DEFAULTS.maxInstallmentMonths),
    storeCommissionPct: getValue('store_commission_pct', DEFAULTS.storeCommissionPct),
    vatPct: getValue('vat_pct', DEFAULTS.vatPct),
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
