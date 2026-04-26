import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export function usePool() {
  return useQuery({
    queryKey: ['collections-session', 'pool'],
    queryFn: async () => {
      const { data } = await api.get('/collections/session/pool');
      return data;
    },
  });
}

export function useClaimPool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.post(`/collections/session/pool/${assignmentId}/claim`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections-session'] });
    },
  });
}
