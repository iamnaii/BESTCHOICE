export const STOCK_SORT_KEYS = [
  'name',
  'category',
  'productCode',
  'accessoryType',
  'specifications',
  'storage',
  'color',
  'connectivity',
  'batteryHealth',
  'hasBox',
  'warrantyExpireDate',
  'costPrice',
  'cashPrice',
  'downPayment',
  'monthlyPayment',
  'stockInDate',
  'quantity',
  'status',
  'branch',
] as const;
export type StockSortKey = (typeof STOCK_SORT_KEYS)[number];
export type StockSortDirection = 'asc' | 'desc';
