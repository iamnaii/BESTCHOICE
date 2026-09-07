import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

/** ที่มาของเครื่องในคิว — API ตัดสินจากความสัมพันธ์จริง (Repossession / TradeIn / poId) */
export type QcSource = 'PO' | 'TRADE_IN' | 'REPOSSESSION' | 'OTHER';

export interface QcPendingProduct {
  id: string;
  name: string;
  imeiSerial: string | null;
  serialNumber: string | null;
  status: 'PHOTO_PENDING';
  category: string | null;
  /** รูปหลักฐานอิสระจากตอนรับ (ไม่ใช่ 6 มุม) */
  photos: string[];
  createdAt: string;
  branch: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  po: { id: string; poNumber: string } | null;
  source: QcSource;
  repossession: { id: string; contractId: string; contractNumber: string } | null;
  /** จำนวนมุมที่ถ่ายแล้ว 0–6 */
  photoAngles: number;
}

interface QcResponse {
  data: QcPendingProduct[];
  total: number;
}

export interface QcCenterFilters {
  branchId?: string;
  poId?: string;
}

/**
 * คิว "รอถ่ายรูป" (2026-09-07): มือสองที่ยังขึ้นขายไม่ได้เพราะรูป 6 มุมยังไม่ครบ — จาก PO,
 * รับซื้อมือสอง และยึดเครื่องคืน. ปุ่ม "ยืนยัน QC" เดิมถูกถอด (ขั้น QC_PENDING ยกเลิก) เหลือ
 * "ไม่รับเข้าคลัง" กับทางไปถ่ายรูปที่หน้าสินค้า
 */
export function useQcCenter(filters: QcCenterFilters) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['qc-center'] });
    queryClient.invalidateQueries({ queryKey: ['qc-pending-count'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });
  };

  const query = useQuery<QcResponse>({
    queryKey: ['qc-center', filters.branchId ?? '', filters.poId ?? ''],
    queryFn: async () => {
      const res = await api.get('/purchase-orders/qc-pending', {
        params: {
          branchId: filters.branchId || undefined,
          poId: filters.poId || undefined,
          limit: 100,
          page: 1,
        },
      });
      const raw = res.data as { data?: QcPendingProduct[]; total?: number };
      return { data: Array.isArray(raw?.data) ? raw.data : [], total: Number(raw?.total) || 0 };
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ productIds, reason }: { productIds: string[]; reason: string }) =>
      api.post('/purchase-orders/qc-reject', { productIds, reason }),
    onSuccess: (res) => {
      invalidate();
      toast.success(res.data?.message ?? 'บันทึกไม่รับเข้าคลังแล้ว');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return {
    products: query.data?.data ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    rejectMutation,
  };
}
