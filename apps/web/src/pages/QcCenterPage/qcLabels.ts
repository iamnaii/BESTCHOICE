import type { QcPendingProduct } from './useQcCenter';

export const qcStatusLabels: Record<string, string> = {
  QC_PENDING: 'รอตรวจ QC',
  PHOTO_PENDING: 'รอถ่ายรูป',
};

export const qcStatusClasses: Record<string, string> = {
  QC_PENDING: 'bg-warning/10 text-warning dark:bg-warning/15',
  PHOTO_PENDING: 'bg-info/10 text-info dark:bg-info/15',
};

/** Client-side PO-number search (server already filters by branch/poId). */
export function filterByPoNumber(products: QcPendingProduct[], term: string): QcPendingProduct[] {
  const t = term.trim().toLowerCase();
  if (!t) return products;
  return products.filter(
    (p) =>
      (p.po?.poNumber ?? '').toLowerCase().includes(t) ||
      (p.name ?? '').toLowerCase().includes(t) ||
      (p.imeiSerial ?? '').toLowerCase().includes(t),
  );
}

/** Header checkbox state from the selected-id set vs the visible rows. */
export function headerCheckState(
  visibleIds: string[],
  selected: Set<string>,
): 'all' | 'some' | 'none' {
  if (visibleIds.length === 0) return 'none';
  const n = visibleIds.filter((id) => selected.has(id)).length;
  if (n === 0) return 'none';
  return n === visibleIds.length ? 'all' : 'some';
}
