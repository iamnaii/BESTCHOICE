import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export interface LineChatMessage {
  id: string;
  role: 'CUSTOMER' | 'STAFF' | 'BOT' | 'SYSTEM';
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'AUDIO' | 'VIDEO' | 'STICKER' | 'LOCATION';
  text: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  createdAt: string;
  readAt: string | null;
  deliveredAt: string | null;
  staff: { id: string; name: string } | null;
}

interface LineChatPage {
  roomId: string | null;
  channel: 'LINE_FINANCE' | 'LINE_SHOP' | null;
  messages: LineChatMessage[];
  hasMore: boolean;
}

const PAGE_SIZE = 30;

/**
 * Loads the customer's LINE chat history (last 30, infinite scroll older)
 * and exposes an inline send. Reuses the staff-chat REST surface — no new
 * data store, no duplicated WebSocket plumbing — so the existing chat
 * inbox keeps working unchanged.
 *
 * Polling: 30s refetch keeps the panel fresh while the collector reads the
 * customer 360, without hammering the API. The chat inbox itself uses
 * WebSocket for instant updates; the collections panel is a passive viewer
 * so polling is a reasonable trade-off.
 */
export function useLineChatPanel(customerId: string | null, enabled: boolean) {
  return useInfiniteQuery<
    LineChatPage,
    Error,
    InfiniteData<LineChatPage>,
    readonly unknown[],
    string | undefined
  >({
    queryKey: ['line-chat-panel', customerId],
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (pageParam) params.set('before', pageParam);
      const { data } = await api.get(
        `/staff-chat/customer/${customerId}/messages?${params.toString()}`,
      );
      return data as LineChatPage;
    },
    getNextPageParam: (last) => {
      if (!last.hasMore || last.messages.length === 0) return undefined;
      // BE returns newest-first; the oldest message in the page is the
      // cursor for the next (older) page.
      return last.messages[last.messages.length - 1].id;
    },
    enabled: enabled && !!customerId,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useSendLineChatMessage(customerId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => {
      if (!customerId) throw new Error('ไม่พบลูกค้า');
      const { data } = await api.post(
        `/staff-chat/customer/${customerId}/messages`,
        { text },
      );
      if (data && data.success === false) {
        throw new Error(data.error ?? 'ส่งข้อความไม่สำเร็จ');
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['line-chat-panel', customerId] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
