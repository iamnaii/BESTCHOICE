import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export type AgingBucketCode = '1-7' | '8-30' | '31-60' | '61-90' | '90+';

export interface AgingBucketRow {
  bucket: AgingBucketCode;
  count: number;
  outstanding: number;
}

export function useAnalyticsAging() {
  return useQuery<AgingBucketRow[]>({
    queryKey: ['collections-analytics-aging'],
    queryFn: async () => (await api.get('/overdue/analytics/aging')).data,
    staleTime: 5 * 60 * 1000,
  });
}
