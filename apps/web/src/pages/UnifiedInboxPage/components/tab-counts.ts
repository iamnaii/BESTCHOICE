type Room = { unreadCount?: number; assignedTo?: { id: string } | null; waitingSince?: string | null };

/** Unread-room counts per inbox tab + waiting rooms. Client-derived fallback from the loaded list
 *  (server counts from GET /staff-chat/rooms/counts are authoritative). */
export function deriveTabCounts(
  sessions: Room[],
  currentUserId?: string,
): { mine: number; all: number; unread: number; waiting: number } {
  const isUnread = (r: Room) => (r.unreadCount ?? 0) > 0;
  const all = sessions.filter(isUnread).length;
  const mine = sessions.filter((r) => isUnread(r) && r.assignedTo?.id === currentUserId).length;
  const waiting = sessions.filter((r) => !!r.waitingSince).length;
  return { mine, all, unread: all, waiting };
}

type ChannelRoom = { unreadCount?: number; channel?: string };

/** Count of unread ROOMS per channel. Client-derived from the loaded list.
 *  Channels with zero unread are omitted. */
export function deriveChannelUnreadCounts(sessions: ChannelRoom[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of sessions) {
    if ((r.unreadCount ?? 0) > 0 && r.channel) {
      out[r.channel] = (out[r.channel] ?? 0) + 1;
    }
  }
  return out;
}
