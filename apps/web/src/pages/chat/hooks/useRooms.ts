import { useQuery } from '@tanstack/react-query';
import { fetchRooms, type ChannelFilter, type ChatRoomSummary, type RoomFilter } from '../lib/chat-api';

/**
 * SLA breach threshold: 5 minutes of no staff response to an active handoff.
 * Temporary client-side check — Task 11 doesn't add a server-side field yet.
 */
const SLA_BREACH_MS = 5 * 60 * 1000;

function computeSlaBreach(room: ChatRoomSummary): boolean {
  if (!room.handoffMode) return false;
  if (room.firstResponseAt) return false;
  const lastAt = new Date(room.lastMessageAt).getTime();
  return Number.isFinite(lastAt) && Date.now() - lastAt > SLA_BREACH_MS;
}

function applyClientFilter(rooms: ChatRoomSummary[], filter: RoomFilter): ChatRoomSummary[] {
  switch (filter) {
    case 'handoff':
      return rooms.filter((r) => r.handoffMode);
    case 'sla_breach':
      return rooms.filter(computeSlaBreach);
    case 'sales':
    case 'service':
      // Intent routing (sales vs service) lands in a later task — fall through for now.
      return rooms;
    case 'all':
    default:
      return rooms;
  }
}

export function useRooms(filter: RoomFilter, channel: ChannelFilter, q?: string) {
  return useQuery({
    queryKey: ['chat-rooms', filter, channel, q ?? ''],
    queryFn: () => fetchRooms({ filter, channel, q }),
    refetchInterval: 10_000,
    select: (response) => applyClientFilter(response.data, filter),
  });
}

export { computeSlaBreach };
