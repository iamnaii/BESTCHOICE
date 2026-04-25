import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface LeaderboardRow {
  collectorId: string;
  name: string;
  assignedCount: number;
  promiseKeptPercent: number;
  avgDaysToFirstContact: number;
  recoveryThisMonth: number;
}

export function useLeaderboard(enabled = true) {
  return useQuery<LeaderboardRow[]>({
    queryKey: ['collections-leaderboard'],
    queryFn: async () => (await api.get('/overdue/analytics/leaderboard')).data,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
