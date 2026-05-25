import type { CannedResponseBubble } from './types';

/**
 * Pure reorder helper for the bubble list.
 *
 * Operates on the FULL bubble array (allBubbles), not on the currently-visible
 * (filtered) subset. Both activeId and overId come from dnd-kit and are always
 * present in allBubbles (since the visible subset is a subset of allBubbles).
 *
 * Hidden bubbles keep their original positions; the moved bubble lands at the
 * global index of overId. After re-fetch the per-channel filter still produces
 * the visually-correct order because the relative ordering between any pair
 * of bubbles that share visibility is preserved.
 *
 * Returns a flat list of `{ id, sortOrder }` ready to POST to the reorder API.
 */
export function reorderBubbles(
  allBubbles: CannedResponseBubble[],
  activeId: string,
  overId: string,
): Array<{ id: string; sortOrder: number }> {
  const fromIdx = allBubbles.findIndex((b) => b.id === activeId);
  const toIdx = allBubbles.findIndex((b) => b.id === overId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
    return allBubbles.map((b, i) => ({ id: b.id, sortOrder: i }));
  }
  const reordered = [...allBubbles];
  const [moved] = reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, moved);
  return reordered.map((b, i) => ({ id: b.id, sortOrder: i }));
}
