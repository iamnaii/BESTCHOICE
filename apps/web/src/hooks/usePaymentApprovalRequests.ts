import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { invalidatePaymentQueries } from '@/pages/PaymentsPage/invalidatePaymentQueries';

export type PaymentApprovalAction =
  | 'RECORD_PAYMENT'
  | 'WAIVE_LATE_FEE'
  | 'VOID_RECEIPT'
  | 'EARLY_PAYOFF';

export const PAYMENT_APPROVAL_ACTION_LABELS: Record<PaymentApprovalAction, string> = {
  RECORD_PAYMENT: 'รับชำระพร้อมรายการที่ต้องอนุมัติ',
  WAIVE_LATE_FEE: 'ยกเว้นค่าปรับ',
  VOID_RECEIPT: 'ยกเลิกใบเสร็จ',
  EARLY_PAYOFF: 'ส่วนลดปิดสัญญา',
};

export interface PaymentApprovalRequest {
  id: string;
  action: PaymentApprovalAction;
  status: string;
  contractId: string;
  contractNumber?: string | null;
  targetId: string;
  requestedById: string;
  requestedByName?: string | null;
  reason: string;
  createdAt: string;
  payload: Record<string, unknown>;
  /** Server-generated display values frozen when the request was created. */
  reviewSummary?: Record<string, unknown>;
  requiredPermissions: string[];
  canApprove: boolean;
}

export interface CreatePaymentApprovalRequest {
  action: PaymentApprovalAction;
  targetId: string;
  reason: string;
  payload: Record<string, unknown>;
}

export function usePaymentApprovalCache() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['payment-approval-requests'] });
    invalidatePaymentQueries(queryClient);
    for (const key of [
      'receipts',
      'pending-summary',
      'contract',
      'contracts',
      'contract-payoff',
      'payment-draft',
    ]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function useCreatePaymentApprovalRequest() {
  const invalidate = usePaymentApprovalCache();
  return useMutation<PaymentApprovalRequest, Error, CreatePaymentApprovalRequest>({
    mutationFn: async (input) => {
      const reason = input.reason.trim();
      if (!reason) throw new Error('กรุณาระบุเหตุผลที่ขออนุมัติ');
      const { data } = await api.post<PaymentApprovalRequest>('/payments/approval-requests', {
        ...input,
        reason,
      });
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('ส่งคำขออนุมัติแล้ว');
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}
