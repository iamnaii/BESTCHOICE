import type { MessageType } from './message';

export type AudienceKey = 'all' | 'active' | 'overdue' | 'new';
export const API_AUDIENCE = {
  all: 'ALL',
  active: 'EXISTING',
  overdue: 'OVERDUE',
  new: 'NEW',
} as const;
export type BroadcastStatus =
  | 'sent'
  | 'scheduled'
  | 'failed'
  | 'pending_approval'
  | 'rejected'
  | 'cancelled'
  | 'sending';

export interface BroadcastHistoryRecord {
  id: string;
  messages: {
    type: MessageType;
    content: Record<string, unknown> | string;
  }[];
  audience: string;
  audienceCount: number;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  createdById: string;
}

export function historyItem(record: BroadcastHistoryRecord) {
  const first = record.messages[0];
  const content = first?.content;
  return {
    ...record,
    status: record.status.toLowerCase() as BroadcastStatus,
    audienceKey: (record.audience.toUpperCase() === 'EXISTING'
      ? 'active'
      : record.audience.toLowerCase()) as AudienceKey,
    messageType: first?.type ?? 'text',
    messagePreview:
      typeof content === 'string'
        ? content
        : String(content?.text || content?.caption || content?.altText || ''),
    messageCount: record.messages.length,
  };
}
