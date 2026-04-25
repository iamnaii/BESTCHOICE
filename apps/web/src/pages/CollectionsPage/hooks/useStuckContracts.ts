import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface StuckContractRow {
  contractId: string;
  contractNumber: string;
  customerName: string;
  customerPhone: string | null;
  branchName: string;
  assignedToId: string | null;
  assignedToName: string | null;
  daysIdle: number;
  outstanding: number;
}

export function useStuckContracts(days: number, enabled = true) {
  return useQuery<StuckContractRow[]>({
    queryKey: ['collections-stuck-contracts', days],
    queryFn: async () => (await api.get(`/overdue/analytics/stuck?days=${days}`)).data,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
