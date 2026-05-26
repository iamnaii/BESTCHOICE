import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';

interface BulkDispatchItem {
  id: string;
  trackingNumber: string;
  evidencePhotoUrl?: string;
}

export function useBulkDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: BulkDispatchItem[]) => {
      const { data } = await api.post<{ updated: Array<{ id: string }>; batchId: string }>(
        '/overdue/letters/bulk/dispatch',
        { items },
      );
      return data;
    },
    onSuccess: (data) => {
      toast.success(`บันทึกการส่ง ${data.updated.length} ฉบับสำเร็จ`);
      qc.invalidateQueries({ queryKey: ['letters'] });
    },
    onError: (err: any) => {
      const message = err?.response?.data?.message ?? err?.message ?? 'เกิดข้อผิดพลาด';
      toast.error(typeof message === 'string' ? message : message.join(', '));
    },
  });
}
