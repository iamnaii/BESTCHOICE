import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export function useLetterActions() {
  const qc = useQueryClient();

  const invalidate = () => qc.invalidateQueries({ queryKey: ['letter-queue'] });

  const markPdfGenerated = useMutation({
    mutationFn: async ({ letterId, pdfUrl }: { letterId: string; pdfUrl: string }) => {
      const { data } = await api.post(`/overdue/letters/${letterId}/pdf-generated`, { pdfUrl });
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึก PDF สำเร็จ');
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const dispatch = useMutation({
    mutationFn: async ({
      letterId,
      trackingNumber,
      evidencePhotoUrl,
    }: {
      letterId: string;
      trackingNumber: string;
      evidencePhotoUrl?: string;
    }) => {
      const { data } = await api.post(`/overdue/letters/${letterId}/dispatch`, {
        trackingNumber,
        ...(evidencePhotoUrl && { evidencePhotoUrl }),
      });
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกการส่งหนังสือสำเร็จ');
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const markDelivered = useMutation({
    mutationFn: async (letterId: string) => {
      const { data } = await api.post(`/overdue/letters/${letterId}/delivered`);
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกรับหนังสือแล้ว');
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const markUndeliverable = useMutation({
    mutationFn: async ({ letterId, reason }: { letterId: string; reason: string }) => {
      const { data } = await api.post(`/overdue/letters/${letterId}/undeliverable`, { reason });
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกส่งไม่ถึงแล้ว');
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const cancel = useMutation({
    mutationFn: async ({ letterId, reason }: { letterId: string; reason: string }) => {
      const { data } = await api.post(`/overdue/letters/${letterId}/cancel`, { reason });
      return data;
    },
    onSuccess: () => {
      toast.success('ยกเลิกหนังสือแล้ว');
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return { markPdfGenerated, dispatch, markDelivered, markUndeliverable, cancel };
}
