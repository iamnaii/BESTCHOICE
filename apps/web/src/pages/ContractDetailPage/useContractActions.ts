/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';

export function useContractActions(id: string | undefined) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const invalidateContract = () => {
    queryClient.invalidateQueries({ queryKey: ['contract', id] });
    queryClient.invalidateQueries({ queryKey: ['contract-preview', id] });
    queryClient.invalidateQueries({ queryKey: ['contract-payoff', id] });
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
  };

  const submitReviewMutation = useMutation({
    mutationFn: async () => {
      try {
        const { data: validation } = await api.get(`/contracts/${id}/validate`);
        if (validation.errors && validation.errors.length > 0) {
          throw { isValidation: true, errors: validation.errors };
        }
      } catch (err: any) {
        if (err.isValidation) throw err;
      }
      const { data } = await api.post(`/contracts/${id}/submit-review`);
      return data;
    },
    onSuccess: () => { toast.success('ส่งตรวจสอบแล้ว'); invalidateContract(); },
    onError: (err: any) => {
      if (err.isValidation) {
        toast.error(`สัญญาไม่ครบถ้วน: ${err.errors.join(', ')}`);
      } else {
        toast.error(getErrorMessage(err));
      }
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (approveNotes?: string) => { const { data } = await api.post(`/contracts/${id}/approve`, { reviewNotes: approveNotes || undefined }); return data; },
    onSuccess: () => { toast.success('อนุมัติสัญญาแล้ว'); invalidateContract(); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async (rejectNotes: string) => { const { data } = await api.post(`/contracts/${id}/reject`, { reviewNotes: rejectNotes }); return data; },
    onSuccess: () => { toast.success('ปฏิเสธสัญญาแล้ว'); invalidateContract(); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const activateMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/activate`); return data; },
    onSuccess: () => { toast.success('เปิดใช้งานสัญญาแล้ว'); invalidateContract(); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const earlyPayoffMutation = useMutation({
    mutationFn: async (paymentMethod: string) => {
      const { data } = await api.post(`/contracts/${id}/early-payoff`, { paymentMethod });
      return data;
    },
    onSuccess: () => { toast.success('ปิดสัญญาก่อนกำหนดสำเร็จ'); invalidateContract(); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { const { data } = await api.delete(`/contracts/${id}`); return data; },
    onSuccess: () => { toast.success('ลบสัญญาแล้ว'); navigate('/contracts'); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const customerLinkMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${id}/customer-link`);
      return data;
    },
    onSuccess: () => { toast.success('สร้างลิงก์สำเร็จ'); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async (editForm: Record<string, unknown>) => {
      const { data } = await api.patch(`/contracts/${id}`, editForm);
      return data;
    },
    onSuccess: () => { toast.success('อัปเดตสัญญาสำเร็จ'); invalidateContract(); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  return {
    invalidateContract,
    submitReviewMutation,
    approveMutation,
    rejectMutation,
    activateMutation,
    earlyPayoffMutation,
    deleteMutation,
    customerLinkMutation,
    updateMutation,
  };
}
