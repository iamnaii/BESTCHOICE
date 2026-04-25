import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useUndoMutation } from './useUndoMutation';

/**
 * Bulk collections actions. Several actions surface an undo snackbar via
 * `useUndoMutation` per Task 8 (collections-ui-p1):
 *
 *   - assign:        ASSIGN kind (30s undo) — caller MUST pass `previousAssignments`
 *                    (Map<contractId, prevAssignedToId | null>) for reverse to work.
 *                    Without it the hook degrades to a plain toast (no undo button).
 *   - sendLine:      SEND_LINE kind — no undo (LINE messages are irreversible).
 *                    Toast only summarises sent/failed counts.
 *   - proposeLock:   PROPOSE_LOCK kind (10s) with live PENDING-status check.
 *                    Reverse requires a per-request DELETE endpoint that is not
 *                    yet shipped — wired structurally so γ-cluster can plug in.
 */
export function useBulkActions(clearSelection: () => void) {
  const qc = useQueryClient();
  const { showUndo } = useUndoMutation();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['collections-queue'] });
    qc.invalidateQueries({ queryKey: ['pending-mdm'] });
  };

  const assign = useMutation({
    mutationFn: async (p: {
      contractIds: string[];
      assignedToId: string;
      /**
       * Optional: previous assignedToId per contract, captured by caller before
       * the mutation runs. When provided, undo re-issues bulk-assign per
       * previous owner. When omitted, undo is unavailable (plain toast only).
       */
      previousAssignments?: Record<string, string | null>;
    }) => {
      const { data } = await api.post('/overdue/bulk/assign', {
        contractIds: p.contractIds,
        assignedToId: p.assignedToId,
      });
      return {
        result: data as { updated: number; requested: number },
        previousAssignments: p.previousAssignments,
      };
    },
    onSuccess: ({ result, previousAssignments }) => {
      const reverse = previousAssignments
        ? async () => {
            // Group contracts by previous assignee so we issue one bulk-assign
            // per target. Contracts with no prior assignee are skipped (cannot
            // currently un-assign via the bulk endpoint).
            const groups = new Map<string, string[]>();
            for (const [contractId, prev] of Object.entries(previousAssignments)) {
              if (!prev) continue;
              const list = groups.get(prev) ?? [];
              list.push(contractId);
              groups.set(prev, list);
            }
            await Promise.all(
              [...groups.entries()].map(([prev, ids]) =>
                api.post('/overdue/bulk/assign', { contractIds: ids, assignedToId: prev }),
              ),
            );
          }
        : undefined;
      showUndo({
        kind: 'ASSIGN',
        message: `มอบหมาย ${result.updated}/${result.requested} รายการสำเร็จ`,
        reverse,
        invalidateKeys: [['collections-queue'], ['pending-mdm']],
      });
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
      // SEND_LINE is irreversible — show recipient counts only.
      showUndo({
        kind: 'SEND_LINE',
        message: `ส่ง LINE ${data.sent}/${data.total} (ล้มเหลว ${data.failed})`,
      });
      clearSelection();
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const proposeLock = useMutation({
    mutationFn: async (p: { contractIds: string[]; reason: string }) => {
      const { data } = await api.post('/overdue/bulk/propose-lock', p);
      return data as {
        proposed: number;
        failed: number;
        requested: number;
        // Backend may surface created MdmLockRequest ids — wired here so
        // when the DELETE endpoint ships, undo becomes a one-line change.
        requestIds?: string[];
      };
    },
    onSuccess: (data) => {
      // Bulk propose-lock creates N MdmLockRequests; per-request reverse is
      // currently unavailable (no DELETE endpoint). Show toast with the
      // PROPOSE_LOCK timing so the UX timing is consistent for QA, but no
      // reverse handler is wired yet — degrades to a plain toast.
      showUndo({
        kind: 'PROPOSE_LOCK',
        message: `เสนอล็อค ${data.proposed}/${data.requested} รายการ รออนุมัติ`,
        // reverse + mdmRequestId intentionally omitted until DELETE endpoint exists.
      });
      clearSelection();
      invalidate();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return { assign, sendLine, proposeLock };
}
