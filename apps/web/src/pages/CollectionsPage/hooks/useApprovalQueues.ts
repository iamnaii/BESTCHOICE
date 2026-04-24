import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import type { PendingEscalation, PendingMdmRequest } from '../types';

export function usePendingEscalations() {
  return useQuery<PendingEscalation[]>({
    queryKey: ['pending-escalations'],
    queryFn: async () => {
      const { data } = await api.get('/overdue/pending-escalations');
      return data;
    },
  });
}

export function usePendingMdm() {
  return useQuery<PendingMdmRequest[]>({
    queryKey: ['pending-mdm'],
    queryFn: async () => {
      const { data } = await api.get('/overdue/mdm-pending');
      return data;
    },
  });
}

export function useApproveEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contractId: string) => {
      const { data } = await api.post(`/overdue/contracts/${contractId}/approve-escalation`);
      return data;
    },
    onSuccess: () => {
      toast.success('อนุมัติ dunning escalation สำเร็จ');
      qc.invalidateQueries({ queryKey: ['pending-escalations'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}

export function useRejectEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contractId, reason }: { contractId: string; reason: string }) => {
      const { data } = await api.post(`/overdue/contracts/${contractId}/reject-escalation`, {
        reason,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('ปฏิเสธแล้ว');
      qc.invalidateQueries({ queryKey: ['pending-escalations'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}

export function useApproveMdm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data } = await api.post(`/overdue/mdm-requests/${requestId}/approve`);
      return data;
    },
    onSuccess: () => {
      toast.success('อนุมัติล็อคเครื่อง');
      qc.invalidateQueries({ queryKey: ['pending-mdm'] });
      qc.invalidateQueries({ queryKey: ['collections-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}

export function useRejectMdm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, reason }: { requestId: string; reason: string }) => {
      const { data } = await api.post(`/overdue/mdm-requests/${requestId}/reject`, { reason });
      return data;
    },
    onSuccess: () => {
      toast.success('ปฏิเสธคำขอ');
      qc.invalidateQueries({ queryKey: ['pending-mdm'] });
      qc.invalidateQueries({ queryKey: ['collections-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}

export function useUnlockMdm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data } = await api.post(`/overdue/mdm-requests/${requestId}/unlock`);
      return data;
    },
    onSuccess: () => {
      toast.success('ปลดล็อคเครื่องสำเร็จ');
      qc.invalidateQueries({ queryKey: ['pending-mdm'] });
      qc.invalidateQueries({ queryKey: ['collections-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}
