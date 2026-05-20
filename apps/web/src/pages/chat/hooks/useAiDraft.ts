import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approveDraft, fetchMessages, releaseToAi, skipDraft, takeOver } from '../lib/chat-api';
import type { Message } from '../components/MessageBubble';

/**
 * useLatestDraft — polls the room messages every 5s and returns the most
 * recent BOT message flagged as a pending draft. Used by the assistant
 * sidebar to surface AI-suggested replies awaiting staff approval.
 *
 * A draft = role BOT + intent starts with `DRAFT:` + not yet delivered.
 */
export function useLatestDraft(roomId: string | null) {
  return useQuery<Message | null>({
    queryKey: ['chat-latest-draft', roomId],
    queryFn: async () => {
      if (!roomId) return null;
      const messages = (await fetchMessages(roomId)) as Message[];
      // Scan newest → oldest and pick the first undelivered BOT draft.
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (
          m.role === 'BOT' &&
          m.intent &&
          m.intent.startsWith('DRAFT:') &&
          !m.deliveredAt
        ) {
          return m;
        }
      }
      return null;
    },
    enabled: !!roomId,
    refetchInterval: 5000,
  });
}

export function useApproveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { draftMessageId: string; editedText?: string; roomId: string }) =>
      approveDraft(args.draftMessageId, args.editedText),
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ['chat-messages', args.roomId] });
      qc.invalidateQueries({ queryKey: ['chat-latest-draft', args.roomId] });
      qc.invalidateQueries({ queryKey: ['chat-rooms'] });
    },
  });
}

export function useSkipDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { draftMessageId: string; roomId: string }) =>
      skipDraft(args.draftMessageId),
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ['chat-messages', args.roomId] });
      qc.invalidateQueries({ queryKey: ['chat-latest-draft', args.roomId] });
    },
  });
}

export function useTakeOver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => takeOver(roomId),
    onSuccess: (_data, roomId) => {
      qc.invalidateQueries({ queryKey: ['chat-rooms'] });
      qc.invalidateQueries({ queryKey: ['chat-room', roomId] });
      qc.invalidateQueries({ queryKey: ['chat-latest-draft', roomId] });
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
      qc.invalidateQueries({ queryKey: ['chat-latest-draft', roomId] });
    },
  });
}
