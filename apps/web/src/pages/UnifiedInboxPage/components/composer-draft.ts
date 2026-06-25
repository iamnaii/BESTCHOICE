/**
 * Save the room you're leaving and load the room you're entering, for the
 * in-memory per-room composer drafts. Mutates `drafts`; returns the incoming
 * room's draft text ('' when none). Only saves on a real room change
 * (prevRoom set and different) so the first open never overwrites a draft.
 */
export function swapRoomDraft(
  drafts: Map<string, string>,
  prevRoom: string | undefined,
  currentRoom: string | undefined,
  outgoingText: string,
): string {
  if (prevRoom && prevRoom !== currentRoom) {
    if (outgoingText) drafts.set(prevRoom, outgoingText);
    else drafts.delete(prevRoom);
  }
  return currentRoom ? (drafts.get(currentRoom) ?? '') : '';
}
