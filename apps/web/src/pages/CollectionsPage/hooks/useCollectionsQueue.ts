import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { ContractRow } from '../types';
import type { QueueFilterState } from './useQueueFilter';

export interface QueueResponse {
  data: ContractRow[];
  total: number;
  page: number;
  limit: number;
  /**
   * True when backend hit the hard row cap (500) — filter should be narrowed.
   * Backend omits this when under cap, so we default to false in `select`.
   */
  truncated: boolean;
}

export type QueueTab = 'today' | 'followup' | 'promise';

export function useCollectionsQueue(params: {
  tab: QueueTab;
  search: string;
  branchId: string;
  page: number;
  limit: number;
  enabled: boolean;
  filter?: QueueFilterState;
}) {
  const { tab, search, branchId, page, limit, enabled, filter } = params;

  // Stable serialized key fragment for the filter so React Query invalidates
  // precisely when filter state changes.
  const filterKey = filter ? JSON.stringify(filter) : '';

  return useQuery<QueueResponse, Error, QueueResponse>({
    queryKey: ['collections-queue', tab, search, branchId, page, limit, filterKey],
    queryFn: async () => {
      const q = new URLSearchParams({ tab, page: String(page), limit: String(limit) });
      if (branchId) q.set('branchId', branchId);
      // C1 fix: push search to server so matches outside the first page are visible
      if (search.trim()) q.set('search', search.trim());
      if (filter) {
        if (filter.assigned) q.set('assignedToId', filter.assigned);
        if (filter.overdueBuckets?.length) q.set('overdueBuckets', filter.overdueBuckets.join(','));
        if (filter.minOutstanding !== undefined)
          q.set('minOutstanding', String(filter.minOutstanding));
        if (filter.maxOutstanding !== undefined)
          q.set('maxOutstanding', String(filter.maxOutstanding));
        if (filter.contractStatuses?.length)
          q.set('contractStatuses', filter.contractStatuses.join(','));
        if (filter.productTypes?.length) q.set('productTypes', filter.productTypes.join(','));
        if (filter.minLetterCount !== undefined)
          q.set('minLetterCount', String(filter.minLetterCount));
        if (filter.lastContacted) q.set('lastContacted', filter.lastContacted);
        if (filter.lineResponse) q.set('lineResponse', filter.lineResponse);
        if (filter.minBrokenPromise !== undefined)
          q.set('minBrokenPromise', String(filter.minBrokenPromise));
        if (filter.hasActivePromise !== undefined)
          q.set('hasActivePromise', String(filter.hasActivePromise));
        if (filter.mdmState) q.set('mdmState', filter.mdmState);
        if (filter.showSkipTracing) q.set('showSkipTracing', 'true');
        if (filter.slipReviewPending) q.set('slipReviewPending', 'true');
      }
      const { data } = await api.get(`/overdue/queue?${q}`);
      return data;
    },
    enabled,
    placeholderData: (prev) => prev,
    select: (res) => ({ ...res, truncated: res.truncated ?? false }),
  });
}
