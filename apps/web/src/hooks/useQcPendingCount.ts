import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * Pending-QC count for the sidebar nav badge.
 * Reuses GET /purchase-orders/qc-pending (includePhotoPending=true) and reads
 * the `total` field with limit=1 — no full page fetched. Mirrors
 * useDraftAssetCount's polling shape (B5 may later switch to summary.waitingQc).
 */
export function useQcPendingCount(enabled: boolean): number | undefined {
  const query = useQuery({
    queryKey: ['qc-pending-count'],
    queryFn: async () => {
      const res = await api.get('/purchase-orders/qc-pending', {
        params: { includePhotoPending: true, limit: 1, page: 1 },
      });
      return res.data as { total: number };
    },
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  return query.data?.total;
}
