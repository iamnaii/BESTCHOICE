import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export interface PartialPaymentReschedulePayload {
  contractId: string;
  amountPaid: number;
  paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'QR_EWALLET';
  evidenceUrl?: string;
  transactionRef?: string;
  /** Optional: required only when amountPaid < outstanding (partial pay) */
  newSettlementDate?: string;
  notes?: string;
}

export function usePartialPaymentReschedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contractId, ...body }: PartialPaymentReschedulePayload) => {
      const { data } = await api.post(
        `/overdue/${contractId}/partial-payment-reschedule`,
        body,
      );
      return data as {
        outstandingBefore: number;
        amountPaid: number;
        outstandingAfter: number;
        isFullPayment: boolean;
        newSettlementDate: string | null;
      };
    },
    onSuccess: (data) => {
      if (data.isFullPayment) {
        toast.success(`รับเงินครบ ${data.amountPaid.toLocaleString()} ฿ — ปิดสัญญาเรียบร้อย`);
      } else {
        toast.success(
          `รับเงิน ${data.amountPaid.toLocaleString()} ฿ + นัดส่วนที่เหลือ ${data.outstandingAfter.toLocaleString()} ฿`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ['collections-queue'] });
      queryClient.invalidateQueries({ queryKey: ['collections-kpi'] });
      queryClient.invalidateQueries({ queryKey: ['contract-call-log-latest'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
