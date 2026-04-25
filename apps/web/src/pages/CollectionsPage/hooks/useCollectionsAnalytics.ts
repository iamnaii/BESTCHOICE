import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface CollectionsAnalytics {
  range: '30d' | '90d';
  weeklyCollectionRate: Array<{
    weekStart: string;
    paidCount: number;
    dueCount: number;
    rate: number;
  }>;
  promiseKeptTrend: Array<{ weekStart: string; kept: number; broken: number }>;
  dunningActionVolume: Array<{ date: string; sent: number; failed: number }>;
  letterDispatchByType: Array<{ type: string; month: string; count: number }>;
  mdmLockVolume: Array<{ date: string; proposed: number; approved: number }>;
}

export function useCollectionsAnalytics(range: '30d' | '90d') {
  return useQuery<CollectionsAnalytics>({
    queryKey: ['collections-analytics', range],
    queryFn: async () => (await api.get(`/overdue/analytics?range=${range}`)).data,
    staleTime: 5 * 60 * 1000,
  });
}
