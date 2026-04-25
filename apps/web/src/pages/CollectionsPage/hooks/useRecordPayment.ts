import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { formatNumber } from '@/utils/formatters';

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'QR_EWALLET';

export interface RecordPaymentPayload {
  contractId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  notes?: string;
  evidenceUrl?: string;
}

/**
 * Records a payment via /payments/auto-allocate — server automatically
 * allocates across next-due installments. Collector doesn't need to pick
 * installmentNo; just enter the amount customer paid.
 *
 * Slip upload is enforced client-side for BANK_TRANSFER and QR_EWALLET methods.
 * evidenceUrl is passed through to backend when provided.
 */
export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: RecordPaymentPayload) => {
      const { data } = await api.post('/payments/auto-allocate', payload);
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success(`บันทึกชำระ ${formatNumber(vars.amount)} ฿ สำเร็จ`);
      qc.invalidateQueries({ queryKey: ['collections-queue'] });
      qc.invalidateQueries({ queryKey: ['collections-kpi'] });
      qc.invalidateQueries({ queryKey: ['customer-360', vars.contractId] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
