export interface ChatWorkActor {
  id: string;
  role: string;
  branchId: string | null;
  accessibleCompanies?: string[];
}
export interface WorkScope {
  company: 'SHOP' | 'FINANCE';
  branchId?: string;
}
export type ChatWorkKind = 'ROOM_WAIT' | 'TODO' | 'FACEBOOK_COMMENT' | 'SERVICE_REQUEST';
export type WorkQueueView = 'WAITING' | 'UNASSIGNED' | 'TODAY' | 'OVERDUE' | 'FOR_ME';
export type ChatWorkTarget = 'ROOM' | 'TODO' | 'NOTE' | 'FACEBOOK_COMMENT' | 'SERVICE_REQUEST';
export interface ChatWorkItem {
  key: string;
  kind: ChatWorkKind;
  roomId: string | null;
  title: string;
  assigneeId: string | null;
  dueAt: string | null;
  waitingSince: string | null;
  targetType: ChatWorkTarget;
  targetId: string;
}
export interface ChatWorkPage {
  data: ChatWorkItem[];
  total: number;
  page: number;
  limit: number;
  counts: Record<WorkQueueView, number>;
  observedAt: string;
}
export interface StaffInboxInput {
  recipientId: string;
  kind: 'CHAT_SLA' | 'FOLLOW_UP' | 'MENTION' | 'HANDOFF' | 'SERVICE_REQUEST';
  roomId?: string;
  todoId?: string;
  dedupeKey: string;
  title: string;
  targetType: ChatWorkTarget;
  targetId: string;
}
