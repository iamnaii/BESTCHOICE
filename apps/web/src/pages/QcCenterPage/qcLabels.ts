import type { QcPendingProduct, QcSource } from './useQcCenter';

/** ป้าย "ที่มา" ต่อแถว — จากความสัมพันธ์จริงของเครื่อง (API เป็นคนตัดสิน) */
export const sourceLabels: Record<QcSource, string> = {
  PO: 'จาก PO',
  TRADE_IN: 'รับซื้อมือสอง',
  REPOSSESSION: 'ยึดเครื่องคืน',
  OTHER: 'อื่น ๆ',
};

export const sourceClasses: Record<QcSource, string> = {
  PO: 'bg-info/10 text-info dark:bg-info/15',
  TRADE_IN: 'bg-primary/10 text-primary dark:bg-primary/15',
  REPOSSESSION: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
  OTHER: 'bg-muted text-foreground',
};

/** ตัวเลือกในกล่องกรอง "ที่มา" — เรียงตามที่เจอบ่อย */
export const SOURCE_FILTER_OPTIONS: { value: QcSource | ''; label: string }[] = [
  { value: '', label: 'ทุกที่มา' },
  { value: 'PO', label: sourceLabels.PO },
  { value: 'TRADE_IN', label: sourceLabels.TRADE_IN },
  { value: 'REPOSSESSION', label: sourceLabels.REPOSSESSION },
];

/**
 * เครื่องยึดคืน "ไม่รับเข้าคลัง" ไม่ได้ — ไม่มีผู้ขายให้ตีกลับ (เครื่องเสียใช้ปรับสต็อกตามเดิม)
 * เครื่องจาก PO / รับซื้อ ตีกลับได้ (soft-delete + เหตุผล)
 */
export const canRejectFromQueue = (p: Pick<QcPendingProduct, 'source'>): boolean =>
  p.source !== 'REPOSSESSION';

/** ปุ่มหลักต่อแถว: ยังไม่ครบ = ไปถ่ายต่อ, ครบแล้ว = ไปตรวจรูปแล้วกดขึ้นขาย (ปุ่มยืนยันอยู่หน้าสินค้า) */
export const primaryActionLabel = (p: Pick<QcPendingProduct, 'photoAngles'>): string =>
  p.photoAngles >= 6 ? 'ตรวจรูปแล้วขึ้นขาย' : 'ไปถ่ายรูป';

/** Client-side search (server already filters by branch/poId): PO / เลขสัญญา / ชื่อ / IMEI */
export function filterByPoNumber(products: QcPendingProduct[], term: string): QcPendingProduct[] {
  const t = term.trim().toLowerCase();
  if (!t) return products;
  return products.filter(
    (p) =>
      (p.po?.poNumber ?? '').toLowerCase().includes(t) ||
      (p.repossession?.contractNumber ?? '').toLowerCase().includes(t) ||
      (p.name ?? '').toLowerCase().includes(t) ||
      (p.imeiSerial ?? '').toLowerCase().includes(t),
  );
}

export function filterBySource(products: QcPendingProduct[], source: QcSource | ''): QcPendingProduct[] {
  if (!source) return products;
  return products.filter((p) => p.source === source);
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
