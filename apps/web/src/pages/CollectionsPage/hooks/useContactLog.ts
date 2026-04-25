import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export interface LogContactPayload {
  contractId: string;
  result: string;
  notes?: string;
  collectionNotes?: string;
  settlementDate?: string;
  settlementNotes?: string;
  // P1 Task 12 — quick-tag enums
  callResult?:
    | 'ANSWERED'
    | 'NO_ANSWER'
    | 'BUSY'
    | 'DEVICE_OFF'
    | 'UNREACHABLE';
  negotiationResult?:
    | 'REQUESTED_EXTENSION'
    | 'WILL_PAY'
    | 'REFUSED'
    | 'REQUESTED_RETURN'
    | 'NEGOTIATING'
    | 'NOT_APPLICABLE';
  // P2 Task 4 — voice memo evidence (S3 URL stored on CallLog).
  voiceMemoUrl?: string;
}

export function useContactLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contractId, ...body }: LogContactPayload) => {
      const { data } = await api.patch(`/overdue/${contractId}/contact-log`, body);
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกการติดต่อสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['collections-queue'] });
      queryClient.invalidateQueries({ queryKey: ['collections-kpi'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
