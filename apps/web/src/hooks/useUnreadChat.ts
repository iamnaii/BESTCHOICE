import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * useUnreadChat — polls unread chat count every 30 seconds.
 * Used by sidebar and inbox to show badge counts.
 */
export function useUnreadChat() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ['chat-unread-count'],
    queryFn: () => api.get('/staff-chat/unread-count').then((r: any) => r.data),
    enabled: !!user,
    refetchInterval: 30000, // every 30 seconds
    staleTime: 10000,
  });

  return data?.unread ?? 0;
}
