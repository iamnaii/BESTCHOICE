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
] as const;

export interface InstallmentConfig {
  interestRate: number;
  minDownPaymentPct: number;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
}

const DEFAULTS: InstallmentConfig = {
  interestRate: 0.08,
  minDownPaymentPct: 0.15,
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
};

/**
 * Load installment-related system configs with defaults
 */
export async function loadInstallmentConfig(
  prisma: PrismaService | { systemConfig: { findMany: (...args: any[]) => Promise<any[]> } },
): Promise<InstallmentConfig> {
  const configs = await prisma.systemConfig.findMany({
    where: { key: { in: [...INSTALLMENT_CONFIG_KEYS] } },
  });

  const getValue = (key: string, def: number): number =>
    parseFloat(configs.find((c: { key: string; value: string }) => c.key === key)?.value || String(def));

  return {
    interestRate: getValue('interest_rate', DEFAULTS.interestRate),
    minDownPaymentPct: getValue('min_down_payment_pct', DEFAULTS.minDownPaymentPct),
    minInstallmentMonths: getValue('min_installment_months', DEFAULTS.minInstallmentMonths),
    maxInstallmentMonths: getValue('max_installment_months', DEFAULTS.maxInstallmentMonths),
  };
}

/**
 * Resolve installment config: prefer InterestConfig entity, fallback to system config
 */
export function resolveInstallmentParams(
  interestConfig: { interestRate: any; minDownPaymentPct: any; minInstallmentMonths: number; maxInstallmentMonths: number } | null,
  systemConfig: InstallmentConfig,
  overrideInterestRate?: number | null,
): {
  interestRate: number;
  minDownPaymentPct: number;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
} {
  return {
    interestRate: overrideInterestRate ?? (interestConfig ? Number(interestConfig.interestRate) : systemConfig.interestRate),
    minDownPaymentPct: interestConfig ? Number(interestConfig.minDownPaymentPct) : systemConfig.minDownPaymentPct,
    minInstallmentMonths: interestConfig ? interestConfig.minInstallmentMonths : systemConfig.minInstallmentMonths,
    maxInstallmentMonths: interestConfig ? interestConfig.maxInstallmentMonths : systemConfig.maxInstallmentMonths,
  };
}
