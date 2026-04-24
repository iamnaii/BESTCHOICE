import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { ContractRow } from '../types';

export interface QueueResponse {
  data: ContractRow[];
  total: number;
  page: number;
  limit: number;
}

export type QueueTab = 'today' | 'followup' | 'promise';

export function useCollectionsQueue(params: {
  tab: QueueTab;
  search: string;
  branchId: string;
  page: number;
  limit: number;
  enabled: boolean;
}) {
  const { tab, search, branchId, page, limit, enabled } = params;
  return useQuery<QueueResponse>({
    queryKey: ['collections-queue', tab, search, branchId, page, limit],
    queryFn: async () => {
      const q = new URLSearchParams({ tab, page: String(page), limit: String(limit) });
      if (branchId) q.set('branchId', branchId);
      const { data } = await api.get(`/overdue/queue?${q}`);
      return data;
    },
    enabled,
    placeholderData: (prev) => prev,
  });
}
