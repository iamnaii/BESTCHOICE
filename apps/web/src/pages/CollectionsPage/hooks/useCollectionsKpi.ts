import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface CollectionsKpi {
  totalOutstanding: number;
  totalLateFees: number;
  queueToday: number;
  queueTodayTrend: number;
  promisedCount: number;
  promiseKeptRate7d: number;
  avgCollectorWorkload: number;
  collectorWorkload?: Array<{ userId: string; name: string; count: number }>;
}

export function useCollectionsKpi(range: '7d' | '30d' = '7d') {
  return useQuery<CollectionsKpi>({
    queryKey: ['collections-kpi', range],
    queryFn: async () => {
      const { data } = await api.get(`/overdue/kpi?range=${range}`);
      return data;
    },
    refetchOnWindowFocus: true,
  });
}
