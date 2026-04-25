import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface MyTodayKpi {
  callsToday: number;
  callsTarget: number;
  lineSentToday: number;
  promisesKeptToday: number;
  /** Sent as a Decimal-precise string from the API (e.g. "12345.67"). */
  collectedTodayBaht: string;
}

/**
 * Per-user "what have I done today?" mini-KPI strip on the Collections page
 * header. Polls every 5 minutes — chips don't need real-time accuracy and
 * the underlying COUNT/SUM queries are cheap but still proportional to
 * call/payment volume.
 */
export function useMyTodayKpi() {
  return useQuery<MyTodayKpi>({
    queryKey: ['collections-my-today-kpi'],
    queryFn: async () => {
      const { data } = await api.get('/overdue/kpi/my-today');
      return data;
    },
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
