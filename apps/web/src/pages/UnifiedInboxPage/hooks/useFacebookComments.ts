import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useChatWorkSettings } from './useChatWork';
export interface CommentReply {
  id: string;
  text: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'UNKNOWN';
  externalId: string | null;
  author?: { name: string };
}
export interface CommentThread {
  id: string;
  revision: number;
  status: 'OPEN' | 'RESPONDED' | 'RESOLVED';
  rootDeleted: boolean;
  rootRecordMissing?: boolean;
  needsReconciliation: boolean;
  assigneeId: string | null;
  customerId: string | null;
  roomId: string | null;
  permalink: string;
  capabilities: { publicReply: boolean; privateReply: boolean; reason: string | null };
  records: {
    id: string;
    commentId: string;
    parentCommentId?: string | null;
    authorName: string | null;
    text: string | null;
    deletedAt: string | null;
    needsReconciliation?: boolean;
  }[];
  replies: CommentReply[];
  recordsTotal: number;
  repliesTotal: number;
  unresolvedReply: { id: string; status: string } | null;
}
export function useFacebookComments(threadId: string, page = 1) {
  const { scope, key } = useChatWorkSettings();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [...key, 'facebook-comment', threadId, page],
    queryFn: () =>
      api
        .get<CommentThread>(`/staff-chat/facebook-comments/${threadId}`, {
          params: { ...scope, page },
        })
        .then((r) => r.data),
    retry: false,
    refetchInterval: 15_000,
  });
  const staff = useQuery({
    queryKey: [...key, 'facebook-comment-staff', threadId],
    queryFn: () =>
      api
        .get<
          { id: string; name: string; role: string }[]
        >(`/staff-chat/facebook-comments/${threadId}/eligible-staff`, { params: scope })
        .then((r) => r.data),
    retry: false,
  });
  return { query, staff, scope, key, refresh: () => client.invalidateQueries({ queryKey: key }) };
}
