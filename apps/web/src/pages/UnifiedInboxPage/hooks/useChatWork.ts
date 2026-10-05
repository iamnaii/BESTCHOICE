import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatWorkFlag, ChatWorkPage, ChatWorkTarget, WorkQueueView } from '@installment/shared';
import { useAuth } from '@/contexts/AuthContext';
import { useLayout } from '@/components/layout/LayoutContext';
import { WORK_COMPANY } from '@/lib/company-scope';
import api from '@/lib/api';
export interface WorkNotification {
  id: string; title: string; roomId: string | null; targetType: ChatWorkTarget; targetId: string;
  createdAt: string; readAt: string | null; targetDeleted: boolean;
}
export interface WorkTarget {
  targetType: string; targetId: string; roomId: string; title: string; content?: string;
  status?: string; dueAt?: string; assigneeId?: string;
}
export function useChatWorkSettings() {
  const { user } = useAuth();
  const { workZone } = useLayout();
  const company = WORK_COMPANY[workZone];
  const scope = { company };
  const key = ['chat-work', user?.id, company, user?.branchId];
  const settings = useQuery({ queryKey: [...key, 'settings'], queryFn: () => api.get<{ flags: Record<ChatWorkFlag, boolean> }>('/staff-chat/work-settings', { params: scope }).then(r => r.data), refetchInterval: 60_000 });
  return { company, scope, key, settings };
}
export function useChatWork(view: WorkQueueView, page: number) {
  const { company, scope, key, settings } = useChatWorkSettings();
  const client = useQueryClient();
  const enabled = !!settings.data?.flags.chat_work_queue_enabled;
  const queue = useQuery({ queryKey: [...key, 'queue', view, page], queryFn: () => api.get<ChatWorkPage>('/staff-chat/work', { params: { ...scope, view, page, limit: 30 } }).then(r => r.data), enabled, refetchInterval: 30_000 });
  const inbox = useQuery({ queryKey: [...key, 'notifications'], queryFn: () => api.get<{ data: WorkNotification[]; unreadCount: number; total: number }>('/staff-chat/work-notifications', { params: { ...scope, limit: 100 } }).then(r => r.data), enabled, refetchInterval: 30_000 });
  return { company, settings, enabled, queue, inbox,
    getTarget: (type: ChatWorkTarget, id: string) => api.get<WorkTarget>(`/staff-chat/work-targets/${type}/${id}`, { params: scope }).then(r => r.data),
    markRead: async (id: string) => { await api.patch(`/staff-chat/work-notifications/${id}/read`, {}, { params: scope }); await client.invalidateQueries({ queryKey: [...key, 'notifications'] }); },
  };
}
