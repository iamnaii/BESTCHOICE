/**
 * D1.2.1 — Approval Workflow frontend actions.
 *
 * Wraps the two new backend endpoints (PRs #912 / #923 / #931):
 *   - POST /expense-documents/:id/submit-for-approval (DRAFT → PENDING_APPROVAL)
 *   - POST /expense-documents/:id/approve            (PENDING_APPROVAL → APPROVED
 *                                                     and optionally auto-POSTED)
 *
 * Both mutations:
 *   - Invalidate ['expenses'] + ['expenses-summary'] on success so list+badges
 *     reflect the new status without a full page refresh, plus that document's
 *     detail / payroll edit form / voucher caches (`invalidateExpenseDoc`).
 *   - Toast a Thai-language success message via sonner.
 *   - Surface API error messages through getErrorMessage().
 *
 * The hook intentionally exposes the raw `useMutation` results (not a custom
 * fire-and-forget wrapper) so callers retain access to `isPending` /
 * `mutateAsync` etc. for fine-grained UI disable/loading behavior.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { invalidateExpenseDoc } from '@/lib/expense-document-cache';
import { payrollConflictOf } from '@/components/expense-form-v4/payroll-system/payroll-status';
import { OPEN_DOC_HINT } from '@/components/expense-form-v4/payroll-system/payroll-copy';

export interface ApprovalActions {
  submitForApproval: ReturnType<typeof useMutation<unknown, unknown, string>>;
  approve: ReturnType<typeof useMutation<unknown, unknown, string>>;
}

/**
 * Toast an expense-document action error. Payroll D4: a 409 from the payroll gate
 * (cutoff / device-conflict flag / stale amounts / OT held by another payroll) shows
 * the server message as is, plus a pointer to the row's "เปิดใบ" item — the detail
 * page shows the dates, flagged days and the diff table.
 */
export function toastActionError(err: unknown): void {
  const conflict = payrollConflictOf(err);
  if (conflict) {
    toast.error(conflict.message || getErrorMessage(err), { description: OPEN_DOC_HINT });
    return;
  }
  toast.error(getErrorMessage(err));
}

export function useApprovalActions(): ApprovalActions {
  const queryClient = useQueryClient();

  // รายการ + หน้ารายละเอียด/ฟอร์มแก้ไข/หน้าสลิปของใบนั้น (ส่งขออนุมัติใบเงินเดือน = server บันทึกใบซ้ำ)
  const invalidate = (id: string) => invalidateExpenseDoc(queryClient, id);

  const submitForApproval = useMutation<unknown, unknown, string>({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/expense-documents/${id}/submit-for-approval`);
      return data;
    },
    onSuccess: (_data, id) => {
      toast.success('ส่งขออนุมัติแล้ว');
      invalidate(id);
    },
    onError: toastActionError,
  });

  const approve = useMutation<unknown, unknown, string>({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/expense-documents/${id}/approve`);
      return data;
    },
    onSuccess: (_data, id) => {
      toast.success('อนุมัติแล้ว');
      invalidate(id);
    },
    onError: toastActionError,
  });

  return { submitForApproval, approve };
}

/**
 * D1.2.1.2 / D1.2.1.4 — compute the user-facing reason that explains why
 * a given DRAFT document needs approval. Returns null when no approval is
 * triggered (e.g. amount < threshold AND docType not in required list) —
 * caller should NOT render the helper text in that case.
 *
 * Mirrors the backend OR-composition (PR #930 D1.2.1.2 comment): either
 * `totalAmount >= threshold` OR `docType ∈ approvalRequiredDocTypes`.
 *
 * Frontend uses this only for the helper text; the gating decision still
 * happens server-side on POST /:id/submit-for-approval (and is re-validated
 * on POST /:id/approve).
 */
export function getApprovalReason(args: {
  totalAmount: number;
  docType: string;
  approvalThreshold: number;
  approvalRequiredDocTypes: string[];
}): string | null {
  const { totalAmount, docType, approvalThreshold, approvalRequiredDocTypes } = args;
  const overThreshold = totalAmount >= approvalThreshold && approvalThreshold > 0;
  const isRequiredType = approvalRequiredDocTypes.includes(docType);
  if (!overThreshold && !isRequiredType) {
    // Threshold = 0 means "approve every doc" — surface that case too.
    if (approvalThreshold === 0) {
      return 'ระบบเปิด Approval Workflow — ทุกเอกสารต้องผ่านการอนุมัติ';
    }
    return null;
  }
  const parts: string[] = [];
  if (overThreshold) {
    parts.push(`ยอด ≥ ${approvalThreshold.toLocaleString('th-TH')} บาท`);
  }
  if (isRequiredType) {
    parts.push(`ประเภทเอกสาร "${docType}" บังคับอนุมัติ`);
  }
  return parts.join(' · ');
}

/**
 * D1.2.1.3 — check whether the current user is permitted to click "อนุมัติ"
 * on a PENDING_APPROVAL document. OWNER is always an approver; other roles
 * must appear in the `approversList` SystemConfig array.
 *
 * Backend re-validates via `assertUserCanApprove()` (PR #931 D1.2.1.3) — this
 * helper only controls button visibility on the client.
 */
export function canApprove(args: {
  userId: string | null | undefined;
  userRole: string | null | undefined;
  approversList: string[];
}): boolean {
  const { userId, userRole, approversList } = args;
  if (!userId) return false;
  if (userRole === 'OWNER') return true;
  return approversList.includes(userId);
}
