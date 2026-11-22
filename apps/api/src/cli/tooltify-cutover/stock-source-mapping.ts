import type { SourceDecision, SourceRef } from './types';
export type StockSourceMapping = Extract<SourceDecision, { action: 'MAP_STOCK_ITEM' }>;
export function validStockSourceMapping(
  d: StockSourceMapping,
  source: SourceRef,
  barcode: string,
  name: string,
  rawCategory: string,
) {
  return (
    d.action === 'MAP_STOCK_ITEM' &&
    d.fileSha256 === source.fileSha256 &&
    d.sourceRows.length === 1 &&
    d.sourceRows[0] === source.row &&
    !!d.reason.trim() &&
    !!d.evidenceRef.trim() &&
    d.expectedBarcode === barcode &&
    d.expectedName === name &&
    d.expectedCategory === rawCategory &&
    rawCategory === '' &&
    ((d.category === 'TABLET' && /^[A-Za-z0-9]{6,20}$/.test(barcode)) ||
      (d.category === 'ACCESSORY' && !!barcode))
  );
}
