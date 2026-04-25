import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export type RecoveryChannel = 'LINE' | 'SMS' | 'CALL' | 'INTERNAL_ALERT';

export interface RecoveryByChannelRow {
  channel: RecoveryChannel;
  actionsSent: number;
  recovered: number;
  recoveryRate: number; // 0-100
  avgRecoveryAmount: number;
}

export function useRecoveryByChannel(params: {
  from?: Date | null;
  to?: Date | null;
  enabled?: boolean;
}) {
  const fromIso = params.from ? params.from.toISOString() : undefined;
  const toIso = params.to ? params.to.toISOString() : undefined;
  return useQuery<RecoveryByChannelRow[]>({
    queryKey: ['collections-recovery-by-channel', fromIso, toIso],
    queryFn: async () => {
      const qs: Record<string, string> = {};
      if (fromIso) qs.from = fromIso;
      if (toIso) qs.to = toIso;
      const search = new URLSearchParams(qs).toString();
      const url = search
        ? `/overdue/analytics/recovery?${search}`
        : '/overdue/analytics/recovery';
      return (await api.get(url)).data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: params.enabled !== false,
  });
}
