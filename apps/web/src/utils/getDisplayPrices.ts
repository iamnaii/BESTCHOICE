export interface ProductPriceRow {
  label: string;
  amount: string | number;
  isDefault: boolean;
}

export interface ProductForDisplay {
  cashPrice?: string | number | null;
  installmentPrice?: string | number | null;
  prices: ProductPriceRow[];
}

export interface DisplayPrices {
  cash: number | null;
  installment: number | null;
}

function pickFromPrices(prices: ProductPriceRow[], exactLabel: string, prefix: string): number | null {
  const exact = prices.find((p) => p.label === exactLabel);
  if (exact) return Number(exact.amount);
  const prefixMatch = prices.find((p) => p.label.startsWith(prefix));
  if (prefixMatch) return Number(prefixMatch.amount);
  return null;
}

export function getDisplayPrices(product: ProductForDisplay): DisplayPrices {
  const cash =
    product.cashPrice != null
      ? Number(product.cashPrice)
      : pickFromPrices(product.prices, 'ราคาเงินสด', 'ราคาเงินสด');

  const installment =
    product.installmentPrice != null
      ? Number(product.installmentPrice)
      : pickFromPrices(product.prices, 'ราคาผ่อน BESTCHOICE', 'ราคาผ่อน');

  return { cash, installment };
}

/**
 * Non-positive (0 / '' / negative / NaN) column value treated as "absent".
 * Exported so callers can independently check "is this raw column actually positive"
 * — e.g. ProductDetailPage/index.tsx compares this against `getPositiveDisplayPrices`'s
 * result to detect when the displayed price is a fallback (prices[] label match) rather
 * than a real column value (fix-round I1, 2026-08-06).
 */
export function normalizePositive(v?: string | number | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * B0 fix-round-1 (reviewer Important finding): `getDisplayPrices` guards its
 * column read with `!= null` only — a column that is exactly `0` (or `''` /
 * negative) is "not null", so it short-circuits straight past the
 * `pickFromPrices` label-chain lookup ('ราคาผ่อน BESTCHOICE' / 'ราคาเงินสด')
 * to whatever the caller does next, silently skipping a real label match.
 *
 * This wrapper normalizes non-positive columns to `null` BEFORE calling
 * `getDisplayPrices`, so the label-chain fallback still runs exactly as it
 * did before columns existed. Callers that need "real money or nothing" (the
 * contract-pricing hook, the product-select price display) should use this
 * instead of calling `getDisplayPrices` directly with raw column values.
 */
export function getPositiveDisplayPrices(product: ProductForDisplay): DisplayPrices {
  return getDisplayPrices({
    cashPrice: normalizePositive(product.cashPrice),
    installmentPrice: normalizePositive(product.installmentPrice),
    prices: product.prices,
  });
}
