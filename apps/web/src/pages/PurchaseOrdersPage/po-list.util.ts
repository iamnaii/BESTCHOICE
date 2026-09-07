/**
 * Pure compute helpers for the PO list/detail. Kept out of the components so
 * the overdue rule (spec decision 4: status=ORDERED AND expectedDate < now)
 * and the partial-receive progress math are unit-tested in one place.
 */

export function receiveProgress(po: {
  items: { quantity: number; receivedQty: number }[];
}): { received: number; ordered: number; pct: number } {
  const ordered = po.items.reduce((s, i) => s + i.quantity, 0);
  const received = po.items.reduce((s, i) => s + i.receivedQty, 0);
  const pct = ordered > 0 ? Math.min(Math.round((received / ordered) * 100), 100) : 0;
  return { received, ordered, pct };
}

export function isOverdue(
  po: { status: string; expectedDate: string | null },
  now: Date = new Date(),
): boolean {
  if (po.status !== 'ORDERED' || !po.expectedDate) return false;
  return new Date(po.expectedDate) < now;
}

/**
 * True when the supplier's contactName just repeats its name, so the UI should
 * hide the redundant second line. Shared by the desktop table column and the
 * mobile POCard so the two views can't drift.
 */
export function supplierContactIsRedundant(supplier: {
  name: string;
  contactName: string | null;
}): boolean {
  return (
    !!supplier.contactName &&
    supplier.contactName.trim().toLowerCase() === supplier.name.trim().toLowerCase()
  );
}

/**
 * ยกเลิกได้ไหม — mirrors PoLifecycleService.cancel(): DRAFT / APPROVED (legacy) / PENDING, or an
 * ORDERED PO with nothing received yet (owner 2026-09-06: approve now lands on ORDERED directly,
 * so the old "cancellable while APPROVED" window must stay reachable from the list and the card).
 */
export function canCancel(po: { status: string; items: { receivedQty: number }[] }): boolean {
  if (['DRAFT', 'APPROVED', 'PENDING'].includes(po.status)) return true;
  return po.status === 'ORDERED' && po.items.every((i) => !i.receivedQty);
}

/**
 * A leading "[tag]" on a name (the way test data is marked) — the list shows it as a small chip
 * beside the name instead of letting it push the name onto a second line.
 */
export function splitLeadingTag(name: string): { tag: string | null; name: string } {
  const trimmed = name.trim();
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(trimmed);
  return m && m[2] ? { tag: m[1], name: m[2] } : { tag: null, name: trimmed };
}

export const pieceCount = (po: { items: { quantity: number }[] }): number =>
  po.items.reduce((s, i) => s + i.quantity, 0);

const looksLikeCode = (s: string) => s !== '' && /^[A-Za-z0-9-]+$/.test(s);

/** "iPhone 17 Pro ×2, iPhone 15, เคส Spigen ×2" — what the PO orders, in one line for the list. */
export function itemsSummary(po: {
  items: {
    brand: string;
    model: string;
    category: string | null;
    quantity: number;
    accessoryType: string | null;
    accessoryBrand: string | null;
  }[];
}): string {
  const single = po.items.length === 1;
  return po.items
    .map((i) => {
      let name: string;
      if (i.category === 'ACCESSORY') {
        const type = i.accessoryType ?? '';
        name = looksLikeCode(type)
          ? i.model || type
          : [type, i.accessoryBrand].filter(Boolean).join(' ') || i.model || 'อุปกรณ์เสริม';
      } else {
        name = i.model || i.brand || 'สินค้า';
      }
      const cond = single && i.category === 'PHONE_USED' ? ' · มือสอง' : single && i.category === 'PHONE_NEW' ? ' · ใหม่' : '';
      return `${name}${cond}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`;
    })
    .join(', ');
}
