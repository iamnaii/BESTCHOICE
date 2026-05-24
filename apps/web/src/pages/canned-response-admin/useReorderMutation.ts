import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { ReorderItem } from './types';

export function useReorderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: ReorderItem[]) =>
      api.patch('/staff-chat/canned-responses/reorder', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canned-responses-admin'] });
      queryClient.invalidateQueries({ queryKey: ['canned-responses-picker'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'เรียงลำดับไม่สำเร็จ');
    },
  });
}
