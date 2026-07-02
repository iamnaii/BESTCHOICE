import { useMutation, useQueryClient } from '@tanstack/react-query';
import { releaseToAi, takeOver } from '../lib/chat-api';

export function useTakeOver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => takeOver(roomId),
    onSuccess: (_data, roomId) => {
      qc.invalidateQueries({ queryKey: ['chat-rooms'] });
      qc.invalidateQueries({ queryKey: ['chat-room', roomId] });
    },
  });
}

export function useReleaseToAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => releaseToAi(roomId),
    onSuccess: (_data, roomId) => {
      qc.invalidateQueries({ queryKey: ['chat-rooms'] });
      qc.invalidateQueries({ queryKey: ['chat-room', roomId] });
    },
  });
}
