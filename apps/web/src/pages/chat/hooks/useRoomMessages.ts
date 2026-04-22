import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMessages } from '../lib/chat-api';

/**
 * useRoomMessages — fetch messages for a specific chat room.
 *
 * Auto-refetches every 5s so AI drafts + inbound customer messages surface
 * promptly without needing the Socket.IO gateway wired up yet. When the
 * gateway ships (later task) this interval can be relaxed.
 */
export function useRoomMessages(roomId: string | null) {
  return useQuery({
    queryKey: ['chat-messages', roomId],
    queryFn: () => (roomId ? fetchMessages(roomId) : Promise.resolve([])),
    enabled: !!roomId,
    refetchInterval: 5000,
  });
}

export function useInvalidateRoomMessages() {
  const qc = useQueryClient();
  return (roomId: string) => qc.invalidateQueries({ queryKey: ['chat-messages', roomId] });
}
