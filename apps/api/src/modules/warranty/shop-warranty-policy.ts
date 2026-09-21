/** Shared warranty policy for catalog, POS, contracts, and receipts. */

export const DEFAULT_SHOP_WARRANTY_DAYS = 60;

/** SystemConfig default for used devices without per-unit warranty days. */
export const SHOP_WARRANTY_DAYS_CONFIG_KEY = 'warranty.shopWarrantyDays';

export interface ShopWarrantyProductInput {
  /** ProductCategory — 'PHONE_USED' คือมือสอง */
  category: string;
  shopWarrantyDays?: number | null;
}

/** Per-device days win (including zero); unset used phones follow the shop default. */
export function resolveShopWarrantyDays(
  product: ShopWarrantyProductInput,
  configValue?: string | null,
): number | null {
  // Explicit per-device terms take priority, including 0 = no warranty.
  if (product.shopWarrantyDays != null) {
    return Number.isInteger(product.shopWarrantyDays) && product.shopWarrantyDays > 0
      ? product.shopWarrantyDays : null;
  }
  if (product.category !== 'PHONE_USED') return null;
  const configured = configValue?.trim() ? Number(configValue) : NaN;
  if (Number.isInteger(configured) && configured >= 0) return configured || null;
  return DEFAULT_SHOP_WARRANTY_DAYS;
}
