import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';

/**
 * useUndoMutation — Sonner toast wrapper with action button + per-action timeout
 *
 * Reversibility matrix (decision Q3 from collections-ui-p1 spec):
 *
 *   action            | timeout | undo behaviour
 *   ------------------+---------+---------------------------------------------
 *   ASSIGN            |   30s   | reassign back to previous assignee
 *   SNOOZE            |   30s   | clear snooze (delete ContractSnooze row)
 *   MARK_UNDELIVERABLE|   30s   | revert letter status to DISPATCHED
 *   PROPOSE_LOCK      |   10s   | DELETE MdmLockRequest IFF status still PENDING
 *                     |         | (live GET /overdue/mdm-requests/:id check)
 *   SEND_LINE         |  none   | irreversible — toast shows recipient count only
 *
 * Live-check semantics (PROPOSE_LOCK):
 *   When the user clicks "เลิกทำ" we issue GET /overdue/mdm-requests/:id and
 *   inspect `status`. If anything other than PENDING (e.g. APPROVED, REJECTED)
 *   we abort the reverse, surface a Thai-language error toast, and skip the
 *   reverse mutation entirely.
 */

export type UndoActionKind =
  | 'ASSIGN'
  | 'SNOOZE'
  | 'MARK_UNDELIVERABLE'
  | 'PROPOSE_LOCK'
  | 'SEND_LINE';

const TIMEOUTS_MS: Record<UndoActionKind, number> = {
  ASSIGN: 30_000,
  SNOOZE: 30_000,
  MARK_UNDELIVERABLE: 30_000,
  PROPOSE_LOCK: 10_000,
  SEND_LINE: 0,
};

export interface UndoOptions {
  /** Action kind — drives timeout + (for PROPOSE_LOCK) live-check semantics. */
  kind: UndoActionKind;
  /** Toast message shown immediately after the primary mutation succeeds. */
  message: string;
  /**
   * Async reverser. Called when the user clicks "เลิกทำ" within the timeout.
   * Throw to surface an error toast — caller does NOT need to wrap in try/catch.
   */
  reverse?: () => Promise<unknown>;
  /**
   * Required for PROPOSE_LOCK: the MdmLockRequest id we will live-check
   * before invoking `reverse`. If status !== PENDING the reverse is blocked.
   */
  mdmRequestId?: string;
  /** React Query keys to invalidate after a successful reverse. */
  invalidateKeys?: ReadonlyArray<readonly unknown[]>;
}

export interface UndoMutationApi {
  /**
   * Show the undo toast. Returns a cleanup that cancels the pending timeout
   * (mostly useful for tests; in production the toast manages its own lifecycle).
   */
  showUndo: (options: UndoOptions) => () => void;
}

/**
 * Hook returning a stable `showUndo(options)` function. Designed to be called
 * from the `onSuccess` of a useMutation after the primary write succeeds.
 *
 * NOTE: this hook does not own the *primary* mutation — callers keep their
 * existing useMutation. It only wraps the toast + undo lifecycle.
 */
export function useUndoMutation(): UndoMutationApi {
  const queryClient = useQueryClient();
  // Track active timers so unmount cancels them — prevents stale undo prompts
  // running reverses against torn-down state.
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const showUndo = useCallback(
    (options: UndoOptions): (() => void) => {
      const { kind, message, reverse, mdmRequestId, invalidateKeys } = options;
      const timeoutMs = TIMEOUTS_MS[kind];

      // SEND_LINE has no undo — surface info toast only and bail out.
      if (kind === 'SEND_LINE' || !reverse || timeoutMs === 0) {
        toast.success(message);
        return () => {};
      }

      let timer: ReturnType<typeof setTimeout> | null = null;
      let cancelled = false;

      const runReverse = async () => {
        if (cancelled) return;
        cancelled = true;
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(timer);
          timer = null;
        }

        try {
          // PROPOSE_LOCK live-check: confirm request is still PENDING before reverse.
          if (kind === 'PROPOSE_LOCK') {
            if (!mdmRequestId) {
              throw new Error('mdmRequestId จำเป็นสำหรับการยกเลิก propose-lock');
            }
            const { data } = await api.get(`/overdue/mdm-requests/${mdmRequestId}`);
            if (!data || data.status !== 'PENDING') {
              toast.error('ไม่สามารถยกเลิกได้แล้ว — คำขอถูกอนุมัติหรือปฏิเสธไปแล้ว');
              return;
            }
          }

          await reverse();
          toast.success('เลิกทำสำเร็จ');
          invalidateKeys?.forEach((key) => {
            queryClient.invalidateQueries({ queryKey: key as readonly unknown[] });
          });
        } catch (err) {
          toast.error(getErrorMessage(err));
        }
      };

      toast.success(message, {
        duration: timeoutMs,
        action: {
          label: 'เลิกทำ',
          onClick: () => {
            void runReverse();
          },
        },
      });

      timer = setTimeout(() => {
        // Timeout elapsed without undo — drop the timer reference.
        if (timer) {
          timersRef.current.delete(timer);
          timer = null;
        }
        cancelled = true;
      }, timeoutMs);
      timersRef.current.add(timer);

      return () => {
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(timer);
          timer = null;
        }
        cancelled = true;
      };
    },
    [queryClient],
  );

  return { showUndo };
}
