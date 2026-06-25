type Room = { unreadCount?: number; assignedTo?: { id: string } | null };

/** Unread-room counts per inbox tab. Client-derived from the loaded list. */
export function deriveTabCounts(
  sessions: Room[],
  currentUserId?: string,
): { mine: number; all: number; unread: number } {
  const isUnread = (r: Room) => (r.unreadCount ?? 0) > 0;
  const all = sessions.filter(isUnread).length;
  const mine = sessions.filter((r) => isUnread(r) && r.assignedTo?.id === currentUserId).length;
  return { mine, all, unread: all };
}
