import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { CashCloseOverviewResponse } from './cash-close';

export const cashCloseOverviewKey = (date: string, branchId: string) => ['shop-tenders', 'cash-close', 'overview', date, branchId];

/**
 * สถานะปิดยอดของวัน + แถบ 14 วัน + เงินที่ยังไม่ได้นำฝาก — ตารางทุกสาขา / แถบวัน / การ์ดเงินค้าง ใช้ key เดียวกัน
 * ⇒ React Query ยิงครั้งเดียวต่อ (วันที่, สาขา)
 */
export function useCashCloseOverview(date: string, branchId: string) {
  return useQuery<CashCloseOverviewResponse>({
    queryKey: cashCloseOverviewKey(date, branchId),
    queryFn: async () => (await api.get('/shop-tenders/cash-close/overview', { params: { date, branchId: branchId || undefined } })).data,
    // ยอดเงินสดต้องสดเสมอ: ขายเงินสด/ตั้งค่าสาขาแล้วกลับมาหน้านี้ ต้องไม่เห็นของเก่าจาก cache 3 นาทีของแอป
    staleTime: 0, refetchOnMount: 'always',
  });
}
