/**
 * การเดินทางของลูกค้า (docs/superpowers/plans/2026-09-15-customer-journey.md)
 * สัญญาร่วมระหว่าง API (โมดูล customer-journey) กับเว็บ (แท็บการเดินทาง · แถบขั้น · การ์ดกิจกรรมล่าสุด)
 * เพื่อไม่ให้สองฝั่งหลุดจากกัน — ค่าในไฟล์นี้ตรงกับคอลัมน์ VARCHAR ของ customer_journey_entries / customer_journey_states
 *
 * 🔴 PDPA: JourneyEvent และแถว entries ห้ามพกข้อความแชท · callLog.notes · เบอร์ · เลขบัตร · ที่อยู่
 */

import { chatSourceChannel } from './customer-sort';

/**
 * 5 ขั้นของเส้นทาง เรียงตามลำดับจริง — ขั้น 2 IDENTIFIED = ได้เบอร์/เลขบัตร · ผูก LINE · เป็นปลายทางของการรวม ไม่ใช่ "คุยแล้ว"
 * (prod: ข้อความพนักงานมี outbound_sent_at แค่ 1 ใน 74,514 ⇒ ขั้น "คุยแล้ว" ว่างเสมอ — คำตัดสิน OD-9 คงกติกา เปลี่ยนแค่ป้าย)
 * ขั้น 3 CREDIT มาก่อนขั้น 4 INTERESTED "นัด / จอง" — เจ้าของสั่ง 2026-09-15 "ต้องเช็คเครดิตก่อนนัด" (ชื่อ enum เดิม ไม่มี migration)
 * ลำดับนี้คือแหล่งเดียว: CASE ของ stage ใน journey-state.sql และ UNBUY_FALLBACK_STAGES (journey-summary.builder.ts) ต้องตรงกัน — builder spec ปักไว้
 */
export const JOURNEY_STAGES = ['CONTACTED', 'IDENTIFIED', 'CREDIT', 'INTERESTED', 'PURCHASED'] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

/** ป้ายไทยของแต่ละขั้น — แถบขั้นใต้หัวหน้ารายละเอียดลูกค้าใช้ชุดนี้ · ลำดับคีย์ = JOURNEY_STAGES */
export const STAGE_LABELS: Record<JourneyStage, string> = {
  CONTACTED: 'ทักเข้ามา',
  IDENTIFIED: 'ได้เบอร์ / ยืนยันตัวตน',
  CREDIT: 'ตรวจเครดิต',
  INTERESTED: 'นัด / จอง',
  PURCHASED: 'ซื้อแล้ว',
};

/**
 * ชนิดแถวของ customer_journey_entries.kind แยกตาม origin
 * SYSTEM = ช่วงเวลาที่ตารางต้นทางเขียนทับจนหาย (เขียนหลัง commit ด้วย dedupe_key) · MANUAL = บันทึกมือ (เฟส 3)
 */
export const JOURNEY_ENTRY_KINDS = {
  SYSTEM: [
    'CONTRACT_ACTIVATED',
    'CONTRACT_REVIEWED',
    'CREDIT_CHECK_OPENED_BY',
    'CREDIT_AI_SCORED',
    'BOT_HANDOFF',
    'CONTACT_ADDED',
    'LINE_LINKED',
    'PRODUCT_LINK_CLICK',
    'PLACEHOLDER_MERGED',
  ],
  MANUAL: ['TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED'],
} as const;
export type JourneyEntryOrigin = keyof typeof JOURNEY_ENTRY_KINDS;
export type JourneySystemEntryKind = (typeof JOURNEY_ENTRY_KINDS)['SYSTEM'][number];
export type JourneyManualEntryKind = (typeof JOURNEY_ENTRY_KINDS)['MANUAL'][number];
export type JourneyEntryKind = JourneySystemEntryKind | JourneyManualEntryKind;

/** origin ของ kind — ตัวเขียนใช้ตั้งคอลัมน์ origin โดยไม่ต้องให้ผู้เรียกส่งมาเอง */
export function journeyEntryOriginOf(kind: JourneyEntryKind): JourneyEntryOrigin {
  return (JOURNEY_ENTRY_KINDS.MANUAL as readonly string[]).includes(kind) ? 'MANUAL' : 'SYSTEM';
}

/** กลุ่มของเหตุการณ์ในไทม์ไลน์ — ลำดับนี้คือลำดับชิปกรองในแท็บการเดินทาง */
export const JOURNEY_EVENT_GROUPS = ['chat', 'credit', 'sale', 'payment', 'collections', 'service', 'points', 'system'] as const;
export type JourneyEventGroup = (typeof JOURNEY_EVENT_GROUPS)[number];

/**
 * ไม่ส่ง groups (ชิป "ทั้งหมด") = กลุ่มเหล่านี้ — GET /customers/:id/journey ใช้ตัดสิน · เว็บใช้บอกว่าชิป "ทั้งหมด" ไม่รวมกลุ่มไหน
 * ชนิดกว้าง (readonly JourneyEventGroup[]) เพื่อให้ .includes(group) รับ JourneyEventGroup ใดก็ได้
 */
export const JOURNEY_DEFAULT_GROUPS: readonly JourneyEventGroup[] = ['chat', 'credit', 'sale', 'collections', 'service'];

/**
 * กลุ่มที่บทบาทไม่เห็น — API ตัดข้อมูลจริง (Task 8/9) · เว็บซ่อนชิปตามชุดเดียวกัน (Task 12) ห้ามลอกไปประกาศซ้ำ
 * ACCOUNTANT ไม่เห็นแชท · SALES เห็นทุกกลุ่ม (คำตัดสิน OD-10 2026-09-15: ยอดชำระ/ติดตามหนี้ SALES เห็นอยู่แล้วในแถบเตือน/การ์ดสัญญา/full-timeline
 * — การตัด PDPA อยู่ที่แหล่ง ไม่ใช่ที่ตารางนี้) · เปลี่ยนสิทธิ์ที่นี่ที่เดียว
 */
export const JOURNEY_HIDDEN_GROUPS: Readonly<Record<string, readonly JourneyEventGroup[]>> = {
  ACCOUNTANT: ['chat'],
};

/** รหัสเหตุผล "หลุด" เรียงตามชิป "ติดป้ายหลุด — เพราะอะไร" — DTO ใช้ @IsIn ชุดนี้ · ต้องเท่ากับคีย์ของ JOURNEY_LOST_REASON_LABELS ตามลำดับ */
export const JOURNEY_LOST_REASONS = ['NOT_INTERESTED', 'BOUGHT_ELSEWHERE', 'CREDIT_FAILED', 'UNREACHABLE', 'OTHER'] as const;
export type JourneyLostReason = (typeof JOURNEY_LOST_REASONS)[number];

/** ป้ายเหตุผล "หลุด" — รหัสตาม lost_reason VARCHAR(20) ของ entries/states · รหัสที่ไม่มีในนี้ ผู้แสดงใช้คำกลางเอง (ห้ามแสดงค่าดิบ) */
export const JOURNEY_LOST_REASON_LABELS: Readonly<Record<string, string>> = {
  NOT_INTERESTED: 'ไม่สนใจ',
  BOUGHT_ELSEWHERE: 'ซื้อที่อื่น',
  CREDIT_FAILED: 'เครดิตไม่ผ่าน',
  UNREACHABLE: 'ติดต่อไม่ได้',
  OTHER: 'อื่น ๆ',
};

/** รหัส "รู้จักร้านจากไหน" เรียงตามชิป 9 ตัว — DTO ใช้ @IsIn ชุดนี้ · ต้องเท่ากับคีย์ของ JOURNEY_HEARD_FROM_LABELS ตามลำดับ */
export const JOURNEY_HEARD_FROM_CODES = ['FB_AD', 'FB_PAGE', 'TIKTOK', 'LINE', 'GOOGLE', 'FRIEND', 'WALK_BY', 'OLD_CUSTOMER', 'OTHER'] as const;
export type JourneyHeardFrom = (typeof JOURNEY_HEARD_FROM_CODES)[number];

/** ป้าย "ลูกค้าบอกว่ารู้จักร้านจาก" — รหัสตาม heard_from VARCHAR(16) (บันทึกมือเฟส 3 + first_source `HEARD:<รหัส>`) */
export const JOURNEY_HEARD_FROM_LABELS: Readonly<Record<string, string>> = {
  FB_AD: 'โฆษณา FB',
  FB_PAGE: 'เพจ/โพสต์',
  TIKTOK: 'TikTok',
  LINE: 'LINE',
  GOOGLE: 'Google',
  FRIEND: 'เพื่อนแนะนำ',
  WALK_BY: 'ผ่านหน้าร้าน',
  OLD_CUSTOMER: 'ลูกค้าเก่า',
  OTHER: 'อื่น ๆ',
};

/**
 * ช่องทางของบันทึกการติดต่อ — ตรงกับ customer_journey_entries.channel VARCHAR(16)
 * ป้ายชุดเดียวของทั้งระบบ (แถวไทม์ไลน์ของ API · ชิปในเว็บ) ห้ามลอกไปประกาศซ้ำ · OTHER มีไว้อ่านแถวเก่าเท่านั้น
 */
export const JOURNEY_TOUCH_CHANNELS = ['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN', 'OTHER'] as const;
export type JourneyTouchChannel = (typeof JOURNEY_TOUCH_CHANNELS)[number];
export const JOURNEY_TOUCH_CHANNEL_LABELS: Record<JourneyTouchChannel, string> = {
  PHONE: 'โทร',
  FB_APP: 'แชทในแอป FB',
  LINE_APP: 'LINE',
  WALK_IN: 'หน้าร้าน',
  OTHER: 'อื่น ๆ',
};

/** ช่องทางที่พนักงานกดบันทึกได้ (ชิปแถว "ช่องทาง" + @IsIn ของ POST …/journey/entries) — scope v2 ไม่มีชิป "อื่น ๆ" */
export const JOURNEY_RECORDABLE_TOUCH_CHANNELS = ['PHONE', 'FB_APP', 'LINE_APP', 'WALK_IN'] as const satisfies readonly JourneyTouchChannel[];
export type JourneyRecordableTouchChannel = (typeof JOURNEY_RECORDABLE_TOUCH_CHANNELS)[number];

/** ผลของการติดต่อ — ตรงกับ customer_journey_entries.outcome VARCHAR(20) · ลำดับ = ลำดับชิปแถว "ผล" */
export const JOURNEY_TOUCH_OUTCOMES = ['APPOINTED', 'VISITED', 'THINKING', 'BUDGET', 'NO_ANSWER', 'BOUGHT_ELSEWHERE', 'NOT_INTERESTED'] as const;
export type JourneyTouchOutcome = (typeof JOURNEY_TOUCH_OUTCOMES)[number];
export const JOURNEY_TOUCH_OUTCOME_LABELS: Record<JourneyTouchOutcome, string> = {
  APPOINTED: 'นัดแล้ว',
  VISITED: 'มาร้านแล้ว',
  THINKING: 'ขอคิดก่อน',
  BUDGET: 'งบ/ดาวน์ไม่พอ',
  NO_ANSWER: 'ไม่รับสาย',
  BOUGHT_ELSEWHERE: 'ซื้อที่อื่น',
  NOT_INTERESTED: 'ไม่สนใจ',
};

/**
 * ผลการติดต่อที่ถามต่อว่า "ติดป้ายหลุดไหม" → เหตุผลที่บันทึกเมื่อกด "ใช่ ติดป้ายหลุด" (จับคู่ 1:1)
 * ไม่รับสายไม่ถาม (Q3) · ลูกค้าที่ซื้อแล้วไม่ถาม (เว็บตัดสินจาก summary.stage ของคำตอบ)
 */
export const JOURNEY_LOST_PROMPT_OUTCOMES: Readonly<Partial<Record<JourneyTouchOutcome, JourneyLostReason>>> = {
  BOUGHT_ELSEWHERE: 'BOUGHT_ELSEWHERE',
  NOT_INTERESTED: 'NOT_INTERESTED',
};

/** ป้ายช่องทางของห้องแชท (enum ChatChannel) — ชุดเดียวของแถวไทม์ไลน์ "ทักแชทครั้งแรกทาง / ทักเพิ่มทาง" และบรรทัดอ่านอย่างเดียวในหน้าสร้างสัญญา */
export const JOURNEY_CHAT_CHANNEL_LABELS: Readonly<Record<string, string>> = {
  FACEBOOK: 'Facebook',
  LINE_SHOP: 'LINE ร้าน',
  LINE_FINANCE: 'LINE การเงิน',
  TIKTOK: 'TikTok',
  WEB: 'เว็บ',
};

/**
 * ถ้อยคำเดียวของ "ลูกค้าเริ่มทักทางไหน" ทุกหน้า (คำตัดสิน 12) — รับ summary.firstChannel หรือ chatSourceOf(<ช่องทางห้อง>)
 * `CHAT_FACEBOOK` → `ทักแชทครั้งแรกทาง Facebook` · ช่องทางที่ไม่มีป้าย → รหัสดิบหลัง `CHAT_` (เหมือนแถวไทม์ไลน์เดิม)
 * ไม่ได้เริ่มจากแชท (WALK_IN · REFERRAL · UNKNOWN · `CHAT_` เปล่า) → null = ไม่แสดงอะไร
 */
export function firstChatContactTitle(firstChannel: string): string | null {
  const channel = chatSourceChannel(firstChannel);
  if (channel === null) return null;
  return `ทักแชทครั้งแรกทาง ${JOURNEY_CHAT_CHANNEL_LABELS[channel] ?? channel}`;
}

/** ผู้ทำให้เกิดเหตุการณ์ — ตรงกับ customer_journey_entries.actor_type VARCHAR(10) */
export const JOURNEY_ACTOR_TYPES = ['STAFF', 'CUSTOMER', 'BOT', 'SYSTEM'] as const;
export type JourneyActorType = (typeof JOURNEY_ACTOR_TYPES)[number];

/** exact = เวลาจริงจากแถวต้นทาง · approximate = เวลาประมาณ (ย้อนหลังจาก updated_at / นำเข้า) เว็บติดป้าย "ประมาณ" */
export type JourneyReliability = 'exact' | 'approximate';
/** SOURCE = อ่านสดจากตารางโดเมน · SYSTEM_ENTRY = แถว entries origin SYSTEM · MANUAL = บันทึกมือ */
export type JourneyEventOrigin = 'SOURCE' | 'SYSTEM_ENTRY' | 'MANUAL';

export interface JourneyEventActor {
  type: JourneyActorType;
  id?: string;
  name?: string;
}

/** หนึ่งแถวในไทม์ไลน์ — ต่อยอดรูปเดียวกับ TimelineEvent ของ overdue/timeline.service.ts (type เป็น string กว้างกว่า) */
export interface JourneyEvent {
  /** `<source>-<rowId>` เช่น `contract-<uuid>` — ไม่ซ้ำภายในคำตอบเดียว ใช้เป็น tie-break ของ cursor */
  id: string;
  type: string;
  group: JourneyEventGroup;
  stage: JourneyStage | null;
  /** ISO 8601 */
  timestamp: string;
  title: string;
  subtitle?: string;
  actor: JourneyEventActor | null;
  reliability: JourneyReliability;
  origin: JourneyEventOrigin;
  /** ลิงก์ภายในเว็บ เช่น /inbox/:roomId · /contracts/:id · /sales/:id · /bookings/:id */
  href?: string;
  /** เฉพาะคีย์ที่ผ่าน whitelist ของ source นั้น — ห้ามข้อความแชท/โน้ตโทร/เบอร์/เลขบัตร/ที่อยู่ */
  metadata?: Record<string, unknown>;
  /** เฉพาะแถวบันทึกมือ (origin MANUAL): id ของแถว customer_journey_entries — ใช้กับ DELETE /customers/:id/journey/entries/:entryId */
  entryId?: string;
  /** เฉพาะแถวบันทึกมือ: ISO เวลาสุดท้ายที่ผู้บันทึกเลิกทำเองได้ (createdAt + 24 ชม.) · null = ผู้อ่านไม่ใช่ผู้บันทึก หรือเลยเวลาแล้ว */
  undoableUntil?: string | null;
  /** เฉพาะแถวบันทึกมือ: ผู้อ่านคนนี้ลบแถวนี้ได้ไหม (API ตัดสิน) — เว็บแสดงลิงก์ "เลิกทำ" ตามค่านี้ ห้ามคำนวณเอง */
  canDelete?: boolean;
}

/** เส้นทางการซื้อ — ตรงกับ customer_journey_states.path VARCHAR(18) */
export type JourneyPath = 'UNKNOWN' | 'INSTALLMENT' | 'CASH' | 'EXTERNAL_FINANCE';
/** not_needed = ขั้นตรวจเครดิตของผู้ซื้อที่ไม่ต้องตรวจ (ซื้อสด / ไฟแนนซ์นอกตรวจ) — ไม่นับเป็น "ข้าม" · API เป็นผู้ตั้งค่าเท่านั้น */
export type JourneyStepState = 'done' | 'current' | 'skipped' | 'todo' | 'not_needed';
/**
 * SYSTEM = หลักฐานจากระบบ · MANUAL = บันทึกมือ (เว็บติดป้าย "พนักงานบันทึก")
 * CHAT_FILE = ขั้นตรวจเครดิตมาจากไฟล์เอกสาร (pdf / doc / xls) ที่ลูกค้าส่งในแชท (เว็บติดป้าย "ส่งไฟล์ในแชท" — API ส่งแค่ชนิดกับเวลา ไม่มีลิงก์ ชื่อ หรือเนื้อหาไฟล์)
 */
export type JourneyStepEvidence = 'SYSTEM' | 'MANUAL' | 'CHAT_FILE';

export interface JourneyStep {
  stage: JourneyStage;
  label: string;
  /** ISO เวลาเข้าขั้น · null = ยังไม่ถึง/ข้าม/ไม่ต้องตรวจ */
  at: string | null;
  state: JourneyStepState;
  evidence: JourneyStepEvidence;
}

/** GET /customers/:id/journey/summary — แถบขั้นใต้หัวหน้า + ตัวเลขที่มา */
export interface JourneySummary {
  stage: JourneyStage;
  stageLabel: string;
  stageEnteredAt: string;
  daysInStage: number;
  path: JourneyPath;
  steps: JourneyStep[];
  firstChannel: string;
  firstSource: string;
  firstSourceLabel: string;
  firstAd: { id: string; name: string } | null;
  heardFrom: string | null;
  contactedAt: string;
  firstStaffReplyAt: string | null;
  firstPurchaseAt: string | null;
  lastCustomerAt: string | null;
  lastTouchAt: string | null;
  /** ยังไม่ซื้อและเงียบเกิน 30 วัน = จำนวนวัน · อื่น ๆ = null (คำนวณตอนอ่าน ไม่เก็บ) */
  silentDays: number | null;
  lost: { at: string; reason: string } | null;
  postSaleBadges: string[];
  creditRejected: boolean;
  /** ถาม "ลูกค้ารู้จักร้านจากไหน" ไหม — API คำนวณครั้งเดียว แบนเนอร์แท็บการเดินทางกับการ์ดหน้าสร้างสัญญาอ่านธงเดียวกัน เว็บห้าม derive เอง */
  askHeardFrom: boolean;
  /** ลูกค้าส่งไฟล์เอกสาร (pdf / doc / xls) ในแชทแล้วแต่ยังไม่มีผลตรวจเครดิต (ยังไม่ซื้อ) — การ์ด KPI "เครดิต" แสดง "ส่งไฟล์แล้ว รอตรวจ" */
  creditFilePending: boolean;
}

/** GET /customers/:id/journey — หน้าละ limit แถว เรียง timestamp desc, id desc · ผู้สนใจที่ถูกรวมแล้วได้ JourneyRedirect แทน */
export interface JourneyListResponse {
  customerId: string;
  /** id ของผู้สนใจที่ถูกรวมเข้าคนนี้ (merged_into_id = customerId) */
  mergedCustomerIds: string[];
  summary?: JourneySummary;
  events: JourneyEvent[];
  /** base64('isoTs|eventId') · null = หมดแล้ว */
  nextCursor: string | null;
  /** เฉพาะหน้าแรก */
  counts?: Partial<Record<JourneyEventGroup, number>>;
  /** ข้อความ "ระบบยังไม่เก็บ" ท้ายแท็บ */
  notRecorded: string[];
}

/** id ที่ขอเป็นผู้สนใจที่ถูกรวมเข้าลูกค้าคนอื่นแล้ว (customers.merged_into_id) — ทั้ง list และ summary ตอบรูปนี้ เว็บพาไปหน้าลูกค้าจริงแบบ replace */
export interface JourneyRedirect {
  redirectToCustomerId: string;
}

/**
 * body ของ POST /customers/:id/journey/entries — scope v2: ไม่มีโน้ต · ไม่มีเปลี่ยนเวลา (เวลา server เสมอ) · ไม่มี roomId
 * clientRequestId = UUID ใหม่ต่อการกดหนึ่งครั้ง (กันบันทึกซ้ำเมื่อคำขอถูกส่งซ้ำ)
 */
export type JourneyManualEntryInput =
  | { kind: 'TOUCHPOINT'; channel: JourneyRecordableTouchChannel; outcome: JourneyTouchOutcome; clientRequestId?: string }
  | { kind: 'HEARD_FROM'; heardFrom: JourneyHeardFrom; clientRequestId?: string }
  | { kind: 'MARKED_LOST'; lostReason: JourneyLostReason; clientRequestId?: string }
  | { kind: 'REOPENED'; clientRequestId?: string };

/** 201 ของ POST …/journey/entries · entryId/event = null เมื่อไม่ได้เขียนแถว (เปิดใหม่ทั้งที่ไม่ได้หลุด) · summary = ผลสรุปสดหลังคำนวณใหม่ */
export interface JourneyEntryCreatedResponse {
  entryId: string | null;
  event: JourneyEvent | null;
  summary: JourneySummary;
}

/** 200 ของ DELETE …/journey/entries/:entryId — ผลสรุปสดหลังเลิกทำ */
export interface JourneyEntryDeletedResponse {
  summary: JourneySummary;
}
