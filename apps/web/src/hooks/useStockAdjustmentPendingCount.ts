import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * จำนวนคำขอตัดสินค้าที่รออนุมัติ (ก้อน 3) สำหรับป้ายบนเมนูข้าง — ขอบเขตตาม role ที่ API บีบให้
 * (เจ้าของ/FM/บัญชี ทุกสาขา · BM/SALES สาขาตัวเอง). Mirrors useQcPendingCount's polling shape.
 */
export function useStockAdjustmentPendingCount(enabled: boolean): number | undefined {
  const query = useQuery({
    queryKey: ['stock-adjustment-pending-count'],
    queryFn: async () => {
      const res = await api.get('/stock-adjustments/pending-count');
      return res.data as { total: number };
    },
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  return query.data?.total;
}
