import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export function useBulkActions(clearSelection: () => void) {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['collections-queue'] });
    qc.invalidateQueries({ queryKey: ['pending-mdm'] });
  };

  const assign = useMutation({
    mutationFn: async (p: { contractIds: string[]; assignedToId: string }) => {
      const { data } = await api.post('/overdue/bulk/assign', p);
      return data as { updated: number; requested: number };
    },
    onSuccess: (data) => {
      toast.success(`มอบหมาย ${data.updated}/${data.requested} รายการสำเร็จ`);
      clearSelection();
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const sendLine = useMutation({
    mutationFn: async (p: {
      contractIds: string[];
      customMessage?: string;
      templateId?: string;
    }) => {
      const { data } = await api.post('/overdue/bulk/send-line', p);
      return data as { sent: number; failed: number; total: number };
    },
    onSuccess: (data) => {
      toast.success(`ส่ง LINE ${data.sent}/${data.total} (ล้มเหลว ${data.failed})`);
      clearSelection();
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const proposeLock = useMutation({
    mutationFn: async (p: { contractIds: string[]; reason: string }) => {
      const { data } = await api.post('/overdue/bulk/propose-lock', p);
      return data as { proposed: number; failed: number; requested: number };
    },
    onSuccess: (data) => {
      toast.success(`เสนอล็อค ${data.proposed}/${data.requested} รายการ รออนุมัติ`);
      clearSelection();
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return { assign, sendLine, proposeLock };
}
