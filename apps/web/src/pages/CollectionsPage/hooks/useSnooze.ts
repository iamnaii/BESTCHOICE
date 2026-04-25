import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

/**
 * Snooze duration presets — must match `SnoozeDuration` enum in the BE
 * (apps/api/src/modules/overdue/dto/snooze.dto.ts).
 *
 * Wall-clock anchors (`tomorrow_9am`, `next_week`) are computed server-side
 * in Asia/Bangkok so behaviour is timezone-stable.
 */
export type SnoozeDuration =
  | '1h'
  | '2h'
  | 'tomorrow_9am'
  | 'next_week'
  | 'custom';

export interface SnoozePayload {
  duration: SnoozeDuration;
  /** Required when duration === 'custom'. ISO 8601 in any timezone. */
  snoozedUntil?: string;
  reason?: string;
}

export function useSnoozeContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contractId,
      payload,
    }: {
      contractId: string;
      payload: SnoozePayload;
    }) => {
      const { data } = await api.post(
        `/overdue/contracts/${contractId}/snooze`,
        payload,
      );
      return data as { id: string; snoozedUntil: string };
    },
    onSuccess: () => {
      toast.success('Snooze สำเร็จ');
      // Refresh queue so the snoozed card disappears.
      qc.invalidateQueries({ queryKey: ['overdue-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}

export function useUnsnoozeContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contractId: string) => {
      const { data } = await api.delete(
        `/overdue/contracts/${contractId}/snooze`,
      );
      return data as { unsnoozed: number };
    },
    onSuccess: () => {
      toast.success('ยกเลิก snooze แล้ว');
      qc.invalidateQueries({ queryKey: ['overdue-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
