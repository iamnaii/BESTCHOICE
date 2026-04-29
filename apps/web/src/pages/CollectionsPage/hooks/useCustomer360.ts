import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface TimelineEvent {
  id: string;
  type: 'CALL' | 'PAYMENT' | 'DUNNING_ACTION' | 'STATUS_CHANGE' | 'MDM' | 'LETTER';
  timestamp: string;
  title: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentScheduleItem {
  id: string;
  installmentNo: number;
  dueDate: string;
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'PARTIALLY_PAID' | 'WAIVED';
  amountDue: number;
  amountPaid: number;
}

export interface ContractDetail {
  id: string;
  contractNumber: string;
  status: string;
  customer: {
    id: string;
    name: string;
    phone: string;
    lineIdFinance?: string | null;
    lineIdShop?: string | null;
    address?: string | null;
  };
  branch: { id: string; name: string };
  installmentCount: number;
  paidInstallments?: number;
  outstanding?: number;
  nextDueDate?: string | null;
  payments?: PaymentScheduleItem[];
}

export function useCustomer360(contractId: string | null) {
  return useQuery({
    queryKey: ['customer-360', contractId],
    queryFn: async () => {
      const [detailRes, timelineRes] = await Promise.all([
        api.get(`/contracts/${contractId}`),
        api.get(`/overdue/contracts/${contractId}/full-timeline`),
      ]);
      return {
        detail: detailRes.data as ContractDetail,
        timeline: timelineRes.data as TimelineEvent[],
      };
    },
    enabled: !!contractId,
    staleTime: 30_000,
  });
}
