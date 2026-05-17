/**
 * D1.1.3.1 — Canonical VAT-rate loader with legacy-key fallback.
 *
 * History: the VAT-rate setting accumulated two different SystemConfig keys
 * over time:
 *   - `vat_pct`  — legacy decimal form (`"0.07"` = 7%). Read by
 *     `config.util.ts::loadInstallmentConfig`, `purchase-orders.service.ts`,
 *     and the `InterestConfigPage` admin form.
 *   - `VAT_RATE` — newer percentage form (`"7"` = 7%). Written by the
 *     `SettingsPage > VAT` tab admin UI.
 *
 * When the OWNER edits "อัตรา VAT" via the new admin tab they save `"7"`
 * to `VAT_RATE`, but downstream code (purchase orders, installment params,
 * etc.) still keys off `vat_pct` and ends up using the seeded default 7%.
 * Worse, a stray `vat_pct = "7"` row (saved by a confused operator) would
 * be parsed as 700% — silent overcharge.
 *
 * Resolution:
 *   - Canonical key going forward is **`VAT_RATE`**. Value stored as a
 *     percentage (e.g. `"7"`). This matches the visible admin label
 *     "อัตรา VAT (%)" and avoids the decimal-vs-percent ambiguity.
 *   - This helper reads `VAT_RATE` first. If absent, falls back to the
 *     legacy `vat_pct` (decimal form) or the also-legacy `vat_rate` (which
 *     never had a writer but appeared in earlier drafts).
 *   - A bootstrap warning is logged when both keys coexist so operations
 *     can clean up the orphan after verifying.
 *
 * Default: 7 (Thailand standard VAT rate).
 *
 * Caller picks the form they need via `asDecimal()` (e.g. 0.07) or
 * `asPercent()` (e.g. 7).
 */
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const log = new Logger('VatRateUtil');

/** Default VAT rate as a percentage (7%). */
export const DEFAULT_VAT_PERCENT = 7;
/** Default VAT rate as a decimal (0.07). */
export const DEFAULT_VAT_DECIMAL = 0.07;

/** Minimal Prisma surface — accepts both PrismaService and a transaction client. */
type SystemConfigReader = {
  systemConfig: {
    findMany: (
      ...args: unknown[]
    ) => Promise<{ key: string; value: string }[]>;
  };
};

/**
 * Parses a raw SystemConfig value into a decimal VAT rate (e.g. 0.07).
 * Returns null if the value is malformed (caller decides fallback).
 *
 * Heuristic: values >= 1 are treated as percentages, values < 1 as decimal
 * fractions. So `"7"` → 0.07 and `"0.07"` → 0.07. `"700"` (clearly nonsense)
 * still passes through but caller can clamp.
 */
export function parseVatValue(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  // Anything >= 1 is treated as a percentage form (`"7"` = 7%).
  // Anything < 1 is treated as the decimal fraction form (`"0.07"` = 7%).
  return n >= 1 ? n / 100 : n;
}

/**
 * Look up VAT rate from SystemConfig with legacy-key fallback.
 *
 * Order of precedence:
 *   1. `VAT_RATE`  (canonical, percentage form)
 *   2. `vat_pct`   (legacy, decimal form OR — in misconfigured DBs —
 *                   percentage form). The shared `parseVatValue` handles
 *                   both shapes.
 *   3. `vat_rate`  (older legacy, decimal form)
 *
 * Returns the decimal form (e.g. 0.07) so caller-side math is uniform.
 * Falls back to {@link DEFAULT_VAT_DECIMAL} when no key is set.
 */
export async function loadVatRateDecimal(
  prisma: SystemConfigReader,
): Promise<number> {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: ['VAT_RATE', 'vat_pct', 'vat_rate'] }, deletedAt: null },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  // Preference order. The first key whose value PARSES wins.
  for (const k of ['VAT_RATE', 'vat_pct', 'vat_rate'] as const) {
    const parsed = parseVatValue(byKey.get(k));
    if (parsed != null) return parsed;
  }
  return DEFAULT_VAT_DECIMAL;
}

/**
 * Same as {@link loadVatRateDecimal} but returns percentage form (e.g. 7).
 */
export async function loadVatRatePercent(
  prisma: SystemConfigReader,
): Promise<number> {
  const decimal = await loadVatRateDecimal(prisma);
  return decimal * 100;
}

/**
 * Bootstrap warning — call once at app startup. If both the canonical
 * `VAT_RATE` and the legacy `vat_pct`/`vat_rate` keys are present in
 * SystemConfig, log a warning so operators clean up the orphan after
 * verifying values agree.
 *
 * Silently no-ops when:
 *   - PrismaService is not connected yet (caller wraps in try/catch)
 *   - Only one (or zero) key(s) present (typical post-migration state)
 */
export async function warnIfVatKeysCollide(prisma: PrismaService): Promise<void> {
  try {
    const rows = await prisma.systemConfig.findMany({
      where: { key: { in: ['VAT_RATE', 'vat_pct', 'vat_rate'] }, deletedAt: null },
      select: { key: true, value: true },
    });
    const present = new Set(rows.map((r) => r.key));
    const hasCanonical = present.has('VAT_RATE');
    const hasLegacy = present.has('vat_pct') || present.has('vat_rate');
    if (hasCanonical && hasLegacy) {
      const legacyKeys = ['vat_pct', 'vat_rate'].filter((k) => present.has(k));
      const summary = rows
        .map((r) => `${r.key}=${r.value}`)
        .join(', ');
      log.warn(
        `[D1.1.3.1] Found legacy ${legacyKeys.join('/')} alongside VAT_RATE — ` +
          `orphan key should be removed manually after verification. ` +
          `(current values: ${summary})`,
      );
    }
  } catch (err) {
    // Boot-time read failures are non-fatal — config helpers fall back to
    // defaults at use-time. We don't want a transient DB blip to crash startup.
    log.debug(
      `[D1.1.3.1] warnIfVatKeysCollide skipped: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
