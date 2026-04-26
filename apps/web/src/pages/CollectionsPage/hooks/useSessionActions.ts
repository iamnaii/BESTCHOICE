import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export type Outcome =
  | 'CALL_CONNECTED'
  | 'CALL_NO_ANSWER'
  | 'LINE_SENT'
  | 'SMS_SENT'
  | 'PAYMENT_RECEIVED'
  | 'PROMISE_MADE'
  | 'REFUSED'
  | 'SKIPPED';

export type SkipReason = 'BUSY' | 'WRONG_QUEUE' | 'PERSONAL_CONFLICT' | 'OTHER';

export function useSessionActions() {
  const qc = useQueryClient();

  const start = useMutation({
    mutationFn: () => api.post('/collections/session/start'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-session', 'mine'] }),
  });

  const action = useMutation({
    mutationFn: ({
      assignmentId,
      outcome,
      notes,
      paymentId,
      lineMessageId,
    }: {
      assignmentId: string;
      outcome: Outcome;
      notes?: string;
      paymentId?: string;
      lineMessageId?: string;
    }) =>
      api.post(`/collections/session/${assignmentId}/action`, {
        outcome,
        notes,
        paymentId,
        lineMessageId,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-session', 'mine'] }),
  });

  const skip = useMutation({
    mutationFn: ({
      assignmentId,
      reason,
      note,
    }: {
      assignmentId: string;
      reason: SkipReason;
      note?: string;
    }) => api.post(`/collections/session/${assignmentId}/skip`, { reason, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-session', 'mine'] }),
  });

  return { start, action, skip };
}
