import { JOURNEY_HEARD_FROM_LABELS, JOURNEY_STAGES, STAGE_LABELS, type JourneyStage, type JourneySummary } from '@installment/shared';
import { calculateDaysElapsed } from '../../utils/date.util';

/** แถว customer_journey_states (ชนิดเดียวกับ Prisma CustomerJourneyState ไม่รวม customerId) */
export interface JourneyStateRow {
  stage: string;
  stageEnteredAt: Date;
  path: string;
  contactedAt: Date;
  identifiedAt: Date | null;
  interestedAt: Date | null;
  creditAt: Date | null;
  firstPurchaseAt: Date | null;
  firstStaffReplyAt: Date | null;
  firstChannel: string;
  firstSource: string;
  firstAdCampaignId: string | null;
  heardFrom: string | null;
  lastCustomerAt: Date | null;
  lastTouchAt: Date | null;
  lostAt: Date | null;
  lostReason: string | null;
  computedAt: Date;
}

/** ค่าที่ไม่อยู่ในแคช — JourneySummaryService อ่านสดทุกคำขอ */
export interface JourneySummaryExtras {
  firstAd: { id: string; name: string } | null;
  interestedByManualEntry: boolean;
  creditRejected: boolean;
  postSaleBadges: string[];
}

type Step = JourneySummary['steps'][number];

/** แคชที่อายุไม่เกินนี้ถือว่าสด (ยกเว้นขั้นซื้อแล้วไม่ตรงกับ BOUGHT_WHERE สด) */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** ป้ายของ acquisition source (CHAT_* ของแชท) — REFERRAL/WALK_IN ใช้คำเดียวกับ SOURCE_LABELS ของเว็บ (sourceLabels.ts ใช้คีย์ ProspectSource คนละชุด) */
const SOURCE_LABELS: Record<string, string> = {
  CHAT_FACEBOOK: 'แชท Facebook',
  CHAT_LINE_SHOP: 'แชท LINE ร้าน',
  CHAT_LINE_FINANCE: 'แชท LINE การเงิน',
  CHAT_TIKTOK: 'แชท TikTok',
  CHAT_WEB: 'แชทหน้าเว็บ',
  REFERRAL: 'คนแนะนำ',
  WALK_IN: 'หน้าร้าน',
};

const CONTRACT_BADGES: Record<string, string> = {
  ACTIVE: 'ผ่อนอยู่', OVERDUE: 'ค้างชำระ', DEFAULT: 'ผิดนัด',
  COMPLETED: 'ปิดสัญญาแล้ว', EARLY_PAYOFF: 'ปิดสัญญาแล้ว', CANCELED: 'ปิดสัญญาแล้ว', TERMINATED: 'ปิดสัญญาแล้ว', CLOSED_BAD_DEBT: 'ปิดสัญญาแล้ว',
};

const iso = (value: Date | null) => (value ? value.toISOString() : null);

function stageTimes(state: JourneyStateRow): Record<JourneyStage, Date | null> {
  return {
    CONTACTED: state.contactedAt,
    IDENTIFIED: state.identifiedAt,
    INTERESTED: state.interestedAt,
    CREDIT: state.creditAt,
    PURCHASED: state.firstPurchaseAt,
  };
}

export function firstSourceLabel(firstSource: string, firstAd: { name: string } | null): string {
  if (firstSource.startsWith('AD:')) return firstAd ? `โฆษณา: ${firstAd.name}` : 'โฆษณา';
  if (firstSource.startsWith('HEARD:')) {
    const key = firstSource.slice('HEARD:'.length);
    return `ลูกค้าบอกว่ารู้จักจาก ${JOURNEY_HEARD_FROM_LABELS[key] ?? key}`;
  }
  return SOURCE_LABELS[firstSource] ?? 'ไม่ทราบ';
}

export function postSaleBadges(input: {
  latestContractStatus: string | null;
  purchaseCount: number;
  hasRepairTicket: boolean;
  skipTracingLost: boolean;
}): string[] {
  const badges: string[] = [];
  const contractBadge = input.latestContractStatus ? CONTRACT_BADGES[input.latestContractStatus] : undefined;
  if (contractBadge) badges.push(contractBadge);
  if (input.purchaseCount >= 2) badges.push('ซื้อซ้ำ');
  if (input.hasRepairTicket) badges.push('มีใบซ่อม');
  if (input.skipTracingLost) badges.push('ติดตามตัวไม่ได้');
  return badges;
}

/** แคชอาจตามไม่ทัน (recompute ล้ม) — ขั้นซื้อแล้วต้องตรงกับ BOUGHT_WHERE สดเสมอ */
export function withLiveBought(state: JourneyStateRow, bought: boolean, now: Date): JourneyStateRow {
  if (bought === (state.stage === 'PURCHASED')) return state;
  if (bought) return { ...state, stage: 'PURCHASED', stageEnteredAt: state.firstPurchaseAt ?? now };
  const times = stageTimes(state);
  const fallback = (['CREDIT', 'INTERESTED', 'IDENTIFIED'] as const).find((stage) => times[stage] !== null);
  return {
    ...state,
    stage: fallback ?? 'CONTACTED',
    stageEnteredAt: (fallback ? times[fallback] : null) ?? state.contactedAt,
    firstPurchaseAt: null,
  };
}

export function buildJourneySummary(state: JourneyStateRow, extras: JourneySummaryExtras, now: Date): JourneySummary {
  const stage = state.stage as JourneyStage;
  const current = JOURNEY_STAGES.indexOf(stage);
  const times = stageTimes(state);
  const purchased = stage === 'PURCHASED';
  // stage ตัดสินขั้นเสมอ — identified_at แช่แข็งด้วย LEAST (Task 3) ⇒ ลบเบอร์แล้ว stage ถอยได้แต่เวลายังอยู่ ขั้นที่ยังไม่ถึง (todo) จึงไม่แสดงวันที่
  const steps = JOURNEY_STAGES.map((key, index): Step => ({
    stage: key,
    label: STAGE_LABELS[key],
    at: index > current ? null : iso(times[key]),
    state: index === current ? 'current' : index > current ? 'todo' : times[key] ? 'done' : 'skipped',
    evidence: key === 'INTERESTED' && extras.interestedByManualEntry ? 'MANUAL' : 'SYSTEM',
  }));
  const lastSeen = [state.lastCustomerAt, state.lastTouchAt, state.contactedAt]
    .filter((value): value is Date => value !== null)
    .reduce((a, b) => (a > b ? a : b));

  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    stageEnteredAt: state.stageEnteredAt.toISOString(),
    daysInStage: Math.max(0, calculateDaysElapsed(state.stageEnteredAt, now)),
    path: state.path as JourneySummary['path'],
    steps,
    firstChannel: state.firstChannel as JourneySummary['firstChannel'],
    firstSource: state.firstSource as JourneySummary['firstSource'],
    firstSourceLabel: firstSourceLabel(state.firstSource, extras.firstAd),
    firstAd: extras.firstAd,
    heardFrom: state.heardFrom as JourneySummary['heardFrom'],
    contactedAt: state.contactedAt.toISOString(),
    firstStaffReplyAt: iso(state.firstStaffReplyAt),
    firstPurchaseAt: iso(state.firstPurchaseAt),
    lastCustomerAt: iso(state.lastCustomerAt),
    lastTouchAt: iso(state.lastTouchAt),
    silentDays: purchased ? null : Math.max(0, calculateDaysElapsed(lastSeen, now)),
    lost: state.lostAt ? { at: state.lostAt.toISOString(), reason: state.lostReason ?? 'OTHER' } : null,
    postSaleBadges: purchased ? extras.postSaleBadges : [],
    creditRejected: !purchased && extras.creditRejected,
  };
}
