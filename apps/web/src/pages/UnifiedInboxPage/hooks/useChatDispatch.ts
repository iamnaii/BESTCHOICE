import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatDispatchState, WorkScope } from '@installment/shared';
import api from '@/lib/api';

/** Mounted with the inbox, not the queue sheet: closing the sheet keeps a ready employee in rotation. */
export function useChatDispatch(
  company: WorkScope['company'],
  workKey: readonly unknown[],
  enabled: boolean,
) {
  const client = useQueryClient();
  const key = [...workKey, 'dispatch'];
  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<ChatDispatchState>('/staff-chat/dispatch', {
        params: { company },
        signal,
      });
      if (!data.ready || !data.generation) return data;
      // A generation is valid only for this ready session. An old tab cannot undo a pause.
      return (
        await api.post<ChatDispatchState>(
          '/staff-chat/dispatch/heartbeat',
          { generation: data.generation },
          { params: { company }, signal },
        )
      ).data;
    },
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
    retry: false,
  });
  const readiness = useMutation({
    mutationFn: async (ready: boolean) => {
      await client.cancelQueries({ queryKey: key });
      const data = (
        await api.patch<ChatDispatchState>(
          '/staff-chat/dispatch/readiness',
          { ready },
          { params: { company } },
        )
      ).data;
      return { data, key, workKey };
    },
    onSuccess: async ({ data, key: submittedKey, workKey: submittedWorkKey }) => {
      await client.cancelQueries({ queryKey: submittedKey });
      client.setQueryData(submittedKey, data);
      void client.invalidateQueries({ queryKey: [...submittedWorkKey, 'queue'] });
      void client.invalidateQueries({ queryKey: ['chat-rooms'] });
    },
  });
  return { query, readiness };
}
