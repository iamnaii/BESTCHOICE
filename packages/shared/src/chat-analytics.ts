import type { WorkScope } from './chat-work';
export interface ChatAnalyticsPeriod extends WorkScope {
  from: string;
  to: string;
  channel?: string;
  staffId?: string;
}
export interface ChatAnalyticsMeta {
  period: ChatAnalyticsPeriod;
  observedAt: string;
  coverage: {
    from: string | null;
    legacyExcluded: number;
    unknownStaffCycles: number;
    unknownPolicyCycles: number;
    mergedExcluded: number;
  };
  cohortDefinition: string;
}
export interface ChatResponseMetrics {
  cycles: number;
  rooms: number;
  nResponded: number;
  nAwaiting: number;
  nResolvedWithoutReply: number;
  humanMedianMinutes: number | null;
  humanP90Minutes: number | null;
  humanSamples: number;
  botMedianMinutes: number | null;
  botP90Minutes: number | null;
  botSamples: number;
  slaBreached: number;
  slaSamples: number;
}
export interface ChatAnalyticsOverview extends ChatAnalyticsMeta {
  responses: ChatResponseMetrics;
  openWorkNow: { roomWaits: number; activeTasks: number; comments: number; totalItems: number };
}
export interface ChatStaffMetrics extends ChatResponseMetrics {
  staffId: string | null;
  name: string;
}
export const CHAT_CYCLE_METRICS = [
  'ALL',
  'ROOMS',
  'HUMAN_SAMPLES',
  'BOT_SAMPLES',
  'SLA_SAMPLES',
  'RESPONDED',
  'AWAITING',
  'RESOLVED',
  'BOT',
  'SLA',
  'UNKNOWN',
] as const;
export type ChatCycleMetric = (typeof CHAT_CYCLE_METRICS)[number];
export interface ChatCycleDetail {
  id: string;
  roomId: string;
  title: string;
  startedAt: string;
  firstHumanSentAt: string | null;
  firstBotSentAt: string | null;
  staffId: string | null;
  assignedAtOpenId: string | null;
  staffName?: string | null;
  assignedAtOpenName?: string | null;
  humanMinutes: number | null;
  botMinutes: number | null;
}
export const CHAT_WORK_METRICS = [
  'HANDOFF_CREATED',
  'HANDOFF_ACCEPTED',
  'HANDOFF_COMPLETED',
  'HANDOFF_OVERDUE',
  'FOLLOW_UP_DUE',
  'FOLLOW_UP_COMPLETED',
  'FOLLOW_UP_OVERDUE',
  'COMMENT_RECEIVED',
  'COMMENT_CONFIRMED',
  'COMMENT_UNRESOLVED',
  'SERVICE_CREATED',
  'SERVICE_LINKED',
  'SERVICE_RESOLVED',
  'SERVICE_OVERDUE',
] as const;
export type ChatWorkMetric = (typeof CHAT_WORK_METRICS)[number];
export interface ChatWorkMetricDetail {
  id: string;
  roomId: string | null;
  title: string;
  occurredAt: string | null;
  targetType: 'TODO' | 'FACEBOOK_COMMENT' | 'SERVICE_REQUEST';
  targetId: string;
}
export interface ChatAnalyticsWork extends ChatAnalyticsMeta {
  handoffs: { created: number; accepted: number; completed: number; overdueNow: number };
  followUps: { due: number; completed: number; overdueNow: number };
  comments: { received: number | null; confirmedReplies: number; unresolvedNow: number };
  serviceRequests: { created: number; linkedToCase: number; resolved: number; overdueNow: number };
  unknownCaseClosureTimes: number;
  filterNotes: string[];
}
export interface ChatLinkedSale {
  id: string;
  businessSaleKey: string;
  number: string;
  type: 'SALE' | 'CONTRACT';
  customerId: string | null;
  customerName: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  amount: string;
  createdAt: string;
  firstInboundAt: string | null;
}
export interface ChatAnalyticsSales extends ChatAnalyticsMeta {
  amount: string;
  documentCount: number;
  customerCount: number;
  unmatchedCount: number;
  unknownSalespersonCount: number;
  basis: string;
  data: ChatLinkedSale[];
  total: number;
  page: number;
  limit: number;
}
export interface ChatAnalyticsFunnel extends ChatAnalyticsMeta {
  stageBasis: 'CURRENT';
  customerCount: number;
  steps: Array<{
    stage: import('./customer-journey').JourneyStage;
    reached: number;
    skipped: number;
  }>;
  lossReasons: Array<{ reason: string; count: number }>;
  scopeNotes: string[];
}
export interface ChatFunnelCustomer {
  customerId: string;
  name: string;
  firstInboundAt: string;
  stage: import('./customer-journey').JourneyStage;
  lostReason: string | null;
}

export interface ChatAnalyticsPage<T> extends ChatAnalyticsMeta {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
export type ChatOpenWorkMetric = 'ALL' | 'ROOM' | 'TASK' | 'COMMENT';
export interface ChatOpenWorkDetail extends Omit<ChatWorkMetricDetail, 'targetType'> {
  kind: Exclude<ChatOpenWorkMetric, 'ALL'>;
  targetType: ChatWorkMetricDetail['targetType'] | 'ROOM';
}
