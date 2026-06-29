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
