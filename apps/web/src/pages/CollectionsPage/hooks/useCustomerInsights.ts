import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export type ContactTimeBucket = 'MORNING' | 'AFTERNOON' | 'EVENING';
export type InsightChannel = 'LINE' | 'SMS' | 'CALL';

export interface CustomerInsights {
  preferredContactTime: ContactTimeBucket | null;
  preferredChannel: InsightChannel | null;
  channelResponseRates: Partial<Record<InsightChannel, number>>;
  lineOnlineAt: string | null;
}

/**
 * Fetch smart customer insights (P2 Task 5) for the Customer 360 panel.
 */
export function useCustomerInsights(customerId: string | null) {
  return useQuery({
    queryKey: ['customer-insights', customerId],
    queryFn: async () => {
      const res = await api.get(`/customers/${customerId}/insights`);
      return res.data as CustomerInsights;
    },
    enabled: !!customerId,
    staleTime: 5 * 60_000,
  });
}
