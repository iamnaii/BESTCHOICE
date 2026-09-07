import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * จำนวนเครื่องในคิว "รอถ่ายรูป" สำหรับป้ายบนเมนูข้าง
 * Reuses GET /purchase-orders/qc-pending (PHOTO_PENDING only since 2026-09-07) and reads
 * the `total` field with limit=1 — no full page fetched. Mirrors useDraftAssetCount's polling shape.
 */
export function useQcPendingCount(enabled: boolean): number | undefined {
  const query = useQuery({
    queryKey: ['qc-pending-count'],
    queryFn: async () => {
      const res = await api.get('/purchase-orders/qc-pending', { params: { limit: 1, page: 1 } });
      return res.data as { total: number };
    },
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  return query.data?.total;
}
