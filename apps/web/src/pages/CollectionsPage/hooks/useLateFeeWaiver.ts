import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export interface LateFeeWaiverRequest {
  id: string;
  contractId: string;
  paymentIds: string[];
  reason: string;
  totalWaiveAmount: string; // Decimal serialized as string
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectedReason: string | null;
  createdAt: string;
  approvedAt: string | null;
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string };
    branch: { id: string; name: string };
  };
  requester: { id: string; name: string };
  approver: { id: string; name: string } | null;
}

export interface CreateLateFeeWaiverPayload {
  contractId: string;
  paymentIds: string[];
  reason: string;
}

const QK = ['late-fee-waivers'] as const;

export function useLateFeeWaivers(status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING') {
  return useQuery({
    queryKey: [...QK, status],
    queryFn: async () => {
      const { data } = await api.get(`/late-fee-waivers?status=${status}`);
      return data as LateFeeWaiverRequest[];
    },
    staleTime: 30_000,
  });
}

export function useCreateLateFeeWaiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateLateFeeWaiverPayload) => {
      const { data } = await api.post('/late-fee-waivers', payload);
      return data as LateFeeWaiverRequest;
    },
    onSuccess: () => {
      toast.success('ส่งคำขอ waive ค่าปรับแล้ว — รออนุมัติ');
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}

export function useApproveLateFeeWaiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/late-fee-waivers/${id}/approve`);
      return data as LateFeeWaiverRequest;
    },
    onSuccess: () => {
      toast.success('อนุมัติ waive ค่าปรับแล้ว');
      qc.invalidateQueries({ queryKey: QK });
      // Customer 360 + queue surfaces show lateFee — refresh both.
      qc.invalidateQueries({ queryKey: ['customer-360'] });
      qc.invalidateQueries({ queryKey: ['overdue-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}

export function useRejectLateFeeWaiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data } = await api.post(`/late-fee-waivers/${id}/reject`, { reason });
      return data as LateFeeWaiverRequest;
    },
    onSuccess: () => {
      toast.success('ปฏิเสธคำขอแล้ว');
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
