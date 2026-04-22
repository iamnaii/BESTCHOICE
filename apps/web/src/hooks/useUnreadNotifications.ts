import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const ROLES_WITH_ACCESS = ['OWNER', 'BRANCH_MANAGER'] as const;

type LogStats = { total: number; sent: number; failed: number; pending: number };

export function useUnreadNotifications() {
  const { user } = useAuth();
  const hasAccess = !!user && ROLES_WITH_ACCESS.includes(user.role as (typeof ROLES_WITH_ACCESS)[number]);

  const { data } = useQuery({
    queryKey: ['notifications-log-stats'],
    queryFn: () => api.get<LogStats>('/notifications/logs/stats').then((r) => r.data),
    enabled: hasAccess,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  return (data?.failed ?? 0) + (data?.pending ?? 0);
}
