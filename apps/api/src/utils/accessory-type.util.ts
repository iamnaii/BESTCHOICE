/**
 * Accessory "type" values a PO line can carry in `accessoryType`.
 *
 * Lines created in the PO wizard use one of the KNOWN labels. Products imported from
 * Tooltify (2026-08) carry their old product CODE in the same column (F1601, CCCT01 …),
 * and a PO line that re-orders one of those copies the code — so "not a known label"
 * means "this is an existing product's code". Mirrored on the web in
 * apps/web/src/pages/PurchaseOrdersPage/po-catalog.util.ts — keep both lists identical.
 */
export const KNOWN_ACCESSORY_TYPES = ['ฟิล์ม', 'ชุดชาร์จ', 'หูฟัง', 'เคส', 'อื่นๆ'] as const;

export function isAccessoryProductCode(accessoryType: string | null | undefined): boolean {
  return !!accessoryType && !(KNOWN_ACCESSORY_TYPES as readonly string[]).includes(accessoryType);
}
