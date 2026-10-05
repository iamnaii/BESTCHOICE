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
export type ChatTaskKind = 'GENERAL' | 'CHAT_FOLLOW_UP' | 'CHAT_HANDOFF' | 'CHAT_SERVICE';
export type ChatHandoffAction = 'ACCEPT' | 'COMPLETE' | 'CANCEL';
export interface ChatWorkItem {
  workKind?: ChatTaskKind;
  orphaned?: boolean;
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

export const CHAT_WORK_FLAGS = [
  'chat_work_queue_enabled',
  'chat_sla_alerts_enabled',
  'chat_follow_up_enabled',
  'chat_mentions_enabled',
  'chat_facebook_comments_enabled',
  'chat_service_requests_enabled',
  'chat_analytics_v2_enabled',
  'chat_cloud_library_enabled',
] as const;
export type ChatWorkFlag = (typeof CHAT_WORK_FLAGS)[number];

export interface ChatSalesContext {
  customerId: string | null;
  journey: import('./customer-journey').JourneySummary | null;
  nextAction: { todoId: string; title: string; dueAt: string | null } | null;
  evidenceLinks: Array<{ kind: 'CREDIT' | 'OFFER' | 'APPOINTMENT' | 'PURCHASE'; id: string; label: string; href?: string }>;
}
