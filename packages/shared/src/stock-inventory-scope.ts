export const STOCK_INVENTORY_SCOPES = ['devices', 'accessories', 'all'] as const;
export type StockInventoryScope = (typeof STOCK_INVENTORY_SCOPES)[number];
export function isStockInventoryScope(value: unknown): value is StockInventoryScope {
  return typeof value === 'string' && (STOCK_INVENTORY_SCOPES as readonly string[]).includes(value);
}
