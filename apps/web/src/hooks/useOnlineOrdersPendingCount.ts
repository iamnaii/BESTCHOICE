import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * จำนวนงานค้างของคำสั่งซื้อออนไลน์ (รอตรวจสลิป + รอแพ็ค + ต้องคืนเงิน) สำหรับ nav badge
 *
 * ใช้ polling 30 วิเหมือน useQcPendingCount — EventsGateway ปิดใน prod (ไม่มี
 * ENABLE_WEBSOCKET) จึงพึ่ง WS ไม่ได้ ถ้าวันหนึ่งเปิด WS ค่อยเปลี่ยนเป็น push ได้
 */
export function useOnlineOrdersPendingCount(enabled: boolean): number | undefined {
  const query = useQuery({
    queryKey: ['online-orders-pending-count'],
    queryFn: async () => {
      const res = await api.get('/admin/online-orders/pending-count');
      return res.data as {
        total: number;
        pendingBankReview: number;
        paid: number;
        unfulfillable: number;
      };
    },
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  return query.data?.total;
}
