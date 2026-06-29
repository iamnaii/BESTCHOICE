import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export interface QcPendingProduct {
  id: string;
  name: string;
  imeiSerial: string | null;
  serialNumber: string | null;
  status: 'QC_PENDING' | 'PHOTO_PENDING';
  category: string | null;
  photos: string[];
  createdAt: string;
  branch: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  po: { id: string; poNumber: string } | null;
}

interface QcResponse {
  data: QcPendingProduct[];
  total: number;
}

export interface QcCenterFilters {
  branchId?: string;
  poId?: string;
}

export function useQcCenter(filters: QcCenterFilters) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['qc-center'] });
    queryClient.invalidateQueries({ queryKey: ['qc-pending-count'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
  };

  const query = useQuery<QcResponse>({
    queryKey: ['qc-center', filters.branchId ?? '', filters.poId ?? ''],
    queryFn: async () => {
      const res = await api.get('/purchase-orders/qc-pending', {
        params: {
          includePhotoPending: true,
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

  const confirmMutation = useMutation({
    mutationFn: async (productIds: string[]) =>
      api.post('/purchase-orders/qc-confirm', { productIds }),
    onSuccess: (res) => {
      invalidate();
      toast.success(res.data?.message ?? 'ยืนยัน QC สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ productIds, reason }: { productIds: string[]; reason: string }) =>
      api.post('/purchase-orders/qc-reject', { productIds, reason }),
    onSuccess: (res) => {
      invalidate();
      toast.success(res.data?.message ?? 'บันทึกไม่ผ่าน QC สำเร็จ');
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
    confirmMutation,
    rejectMutation,
  };
}
