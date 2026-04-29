import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export interface FailedAction {
  id: string;
  contractId: string;
  channel: string;
  status: string;
  messageContent: string | null;
  result: string | null;
  createdAt: string;
  dunningRule: { name: string };
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string; lineIdFinance: string | null };
  };
}

export function useFailedActions() {
  return useQuery<FailedAction[]>({
    queryKey: ['line-retries'],
    queryFn: async () => (await api.get('/overdue/line-retries?limit=100')).data,
    staleTime: 60_000,
  });
}

export function useRetryAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (actionId: string) =>
      (await api.post(`/overdue/line-retries/${actionId}/retry`)).data,
    onSuccess: (data) => {
      if (data.status === 'SENT') toast.success('ส่งสำเร็จ');
      else toast.warning('ยังส่งไม่สำเร็จ จะลองใหม่ได้');
      qc.invalidateQueries({ queryKey: ['line-retries'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}
