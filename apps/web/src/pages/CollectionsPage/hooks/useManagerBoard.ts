import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export function useManagerBoard() {
  return useQuery({
    queryKey: ['collections-manage', 'board'],
    queryFn: async () => {
      const { data } = await api.get('/collections/manage/board');
      return data;
    },
    refetchInterval: 30_000,
  });
}

export function useManageActions() {
  const qc = useQueryClient();

  const assign = useMutation({
    mutationFn: ({
      assignmentId,
      toCollectorId,
    }: {
      assignmentId: string;
      toCollectorId: string | null;
    }) => api.post('/collections/manage/assign', { assignmentId, toCollectorId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-manage'] }),
  });

  const lock = useMutation({
    mutationFn: () => api.post('/collections/manage/lock'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-manage'] }),
  });

  const transfer = useMutation({
    mutationFn: (body: { fromCollectorId: string; toCollectorId: string; count: number }) =>
      api.post('/collections/manage/transfer', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-manage'] }),
  });

  const closeSession = useMutation({
    mutationFn: (collectorId: string) =>
      api.post(`/collections/manage/close-session/${collectorId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-manage'] }),
  });

  const autoBalance = useMutation({
    mutationFn: () => api.post('/collections/manage/auto-balance'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-manage'] }),
  });

  return { assign, lock, transfer, closeSession, autoBalance };
}
