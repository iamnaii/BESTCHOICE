import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export type EscalationAction = 'LETTER' | 'MDM' | 'LEGAL';

export interface EscalatePayload {
  contractId: string;
  action: EscalationAction;
  reason: string;
}

const ACTION_LABELS: Record<EscalationAction, string> = {
  LETTER: 'ส่งจดหมายเตือน',
  MDM: 'เสนอล็อคเครื่อง',
  LEGAL: 'ส่งให้ทนาย',
};

export function useEscalate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contractId, ...body }: EscalatePayload) => {
      const { data } = await api.post(`/overdue/${contractId}/escalate`, body);
      return data;
    },
    onSuccess: (_data, vars) => {
      toast.success(`Escalation: ${ACTION_LABELS[vars.action]} สำเร็จ`);
      queryClient.invalidateQueries({ queryKey: ['collections-queue'] });
      queryClient.invalidateQueries({ queryKey: ['collections-kpi'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}

/**
 * Threshold ที่ตรงกับ backend (BUSINESS_RULES.ESCALATION_BROKEN_PROMISE_THRESHOLD).
 * เก็บเป็น const ฝั่ง FE เพื่อให้ ContactLogDialog/ContractCard ตัดสินใจได้โดยไม่ต้องเรียก API
 */
export const ESCALATION_BROKEN_PROMISE_THRESHOLD = 2;
