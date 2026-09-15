import {
  JOURNEY_STAGES,
  STAGE_LABELS,
  type JourneyEvent,
  type JourneyListResponse,
  type JourneyStage,
  type JourneyStep,
  type JourneySummary,
} from '@installment/shared';

export function stageSteps(
  states: Record<JourneyStage, JourneyStep['state']>,
  at: Partial<Record<JourneyStage, string>> = {},
  manual: readonly JourneyStage[] = [],
): JourneyStep[] {
  return JOURNEY_STAGES.map(
    (stage): JourneyStep => ({
      stage,
      label: STAGE_LABELS[stage],
      at: states[stage] === 'todo' || states[stage] === 'skipped' ? null : at[stage] ?? null,
      state: states[stage],
      evidence: manual.includes(stage) ? 'MANUAL' : 'SYSTEM',
    }),
  );
}

export function journeySummary(over: Partial<JourneySummary> = {}): JourneySummary {
  return {
    stage: 'CONTACTED',
    stageLabel: STAGE_LABELS.CONTACTED,
    stageEnteredAt: '2026-09-01T03:00:00.000Z',
    daysInStage: 14,
    path: 'UNKNOWN',
    steps: stageSteps(
      { CONTACTED: 'current', IDENTIFIED: 'todo', INTERESTED: 'todo', CREDIT: 'todo', PURCHASED: 'todo' },
      { CONTACTED: '2026-09-01T03:00:00.000Z' },
    ),
    firstChannel: 'CHAT_FACEBOOK',
    firstSource: 'CHAT_FACEBOOK',
    firstSourceLabel: 'แชท Facebook',
    firstAd: null,
    heardFrom: null,
    contactedAt: '2026-09-01T03:00:00.000Z',
    firstStaffReplyAt: null,
    firstPurchaseAt: null,
    lastCustomerAt: '2026-09-01T03:00:00.000Z',
    lastTouchAt: null,
    silentDays: null,
    lost: null,
    postSaleBadges: [],
    creditRejected: false,
    ...over,
  };
}

export function journeyEvent(over: Partial<JourneyEvent> = {}): JourneyEvent {
  return {
    id: 'chat_room-r1',
    type: 'CHAT_ROOM_OPENED',
    group: 'chat',
    stage: 'CONTACTED',
    timestamp: '2026-09-01T03:00:00.000Z',
    title: 'ทักแชทครั้งแรกทาง Facebook',
    actor: { type: 'CUSTOMER' },
    reliability: 'exact',
    origin: 'SOURCE',
    ...over,
  };
}

export function journeyPage(over: Partial<JourneyListResponse> = {}): JourneyListResponse {
  return { customerId: 'c1', mergedCustomerIds: [], events: [], nextCursor: null, notRecorded: [], ...over };
}
