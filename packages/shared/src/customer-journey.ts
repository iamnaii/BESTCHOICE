/**
 * การเดินทางของลูกค้า (docs/superpowers/plans/2026-09-15-customer-journey.md)
 * สัญญาร่วมระหว่าง API (โมดูล customer-journey) กับเว็บ (แท็บการเดินทาง · แถบขั้น · การ์ดกิจกรรมล่าสุด)
 * เพื่อไม่ให้สองฝั่งหลุดจากกัน — ค่าในไฟล์นี้ตรงกับคอลัมน์ VARCHAR ของ customer_journey_entries / customer_journey_states
 *
 * 🔴 PDPA: JourneyEvent และแถว entries ห้ามพกข้อความแชท · callLog.notes · เบอร์ · เลขบัตร · ที่อยู่
 */

/**
 * 5 ขั้นของเส้นทาง เรียงตามลำดับจริง — ขั้น 2 IDENTIFIED = ได้เบอร์/เลขบัตร · ผูก LINE · เป็นปลายทางของการรวม ไม่ใช่ "คุยแล้ว"
 * (prod: ข้อความพนักงานมี outbound_sent_at แค่ 1 ใน 74,514 ⇒ ขั้น "คุยแล้ว" ว่างเสมอ — คำตัดสิน OD-9 คงกติกา เปลี่ยนแค่ป้าย)
 */
export const JOURNEY_STAGES = [
  'CONTACTED',
  'IDENTIFIED',
  'INTERESTED',
  'CREDIT',
  'PURCHASED',
] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

/** ป้ายไทยของแต่ละขั้น — แถบขั้นใต้หัวหน้ารายละเอียดลูกค้าใช้ชุดนี้ */
export const STAGE_LABELS: Record<JourneyStage, string> = {
  CONTACTED: 'ทักเข้ามา',
  IDENTIFIED: 'ได้เบอร์ / ยืนยันตัวตน',
  INTERESTED: 'สนใจจริง / นัด-จอง',
  CREDIT: 'ตรวจเครดิต',
  PURCHASED: 'ซื้อแล้ว',
};

/**
 * ชนิดแถวของ customer_journey_entries.kind แยกตาม origin
 * SYSTEM = ช่วงเวลาที่ตารางต้นทางเขียนทับจนหาย (เขียนหลัง commit ด้วย dedupe_key) · MANUAL = บันทึกมือ (เฟส 3)
 * DEVICE_RETURNED (2026-09-20) = FINANCE ยืนยันใบรับเครื่องคืน — เขียนที่ DeviceReturnsService.confirm, data = เลขใบ/เลขสัญญา/รหัสปิดเท่านั้น
 */
export const JOURNEY_ENTRY_KINDS = {
  SYSTEM: [
    'CONTRACT_ACTIVATED',
    'CONTRACT_REVIEWED',
    'DEVICE_RETURNED',
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
export const JOURNEY_EVENT_GROUPS = [
  'chat',
  'credit',
  'sale',
  'payment',
  'collections',
  'service',
  'points',
  'system',
] as const;
export type JourneyEventGroup = (typeof JOURNEY_EVENT_GROUPS)[number];

/**
 * ไม่ส่ง groups (ชิป "ทั้งหมด") = กลุ่มเหล่านี้ — GET /customers/:id/journey ใช้ตัดสิน · เว็บใช้บอกว่าชิป "ทั้งหมด" ไม่รวมกลุ่มไหน
 * ชนิดกว้าง (readonly JourneyEventGroup[]) เพื่อให้ .includes(group) รับ JourneyEventGroup ใดก็ได้
 */
export const JOURNEY_DEFAULT_GROUPS: readonly JourneyEventGroup[] = [
  'chat',
  'credit',
  'sale',
  'collections',
  'service',
];

/**
 * กลุ่มที่บทบาทไม่เห็น — API ตัดข้อมูลจริง (Task 8/9) · เว็บซ่อนชิปตามชุดเดียวกัน (Task 12) ห้ามลอกไปประกาศซ้ำ
 * ACCOUNTANT ไม่เห็นแชท · SALES เห็นทุกกลุ่ม (คำตัดสิน OD-10 2026-09-15: ยอดชำระ/ติดตามหนี้ SALES เห็นอยู่แล้วในแถบเตือน/การ์ดสัญญา/full-timeline
 * — การตัด PDPA อยู่ที่แหล่ง ไม่ใช่ที่ตารางนี้) · เปลี่ยนสิทธิ์ที่นี่ที่เดียว
 */
export const JOURNEY_HIDDEN_GROUPS: Readonly<Record<string, readonly JourneyEventGroup[]>> = {
  ACCOUNTANT: ['chat'],
};

/** ป้ายเหตุผล "หลุด" — รหัสตาม lost_reason VARCHAR(20) ของ entries/states · รหัสที่ไม่มีในนี้ ผู้แสดงใช้คำกลางเอง (ห้ามแสดงค่าดิบ) */
export const JOURNEY_LOST_REASON_LABELS: Readonly<Record<string, string>> = {
  NOT_INTERESTED: 'ไม่สนใจ',
  BOUGHT_ELSEWHERE: 'ซื้อที่อื่น',
  CREDIT_FAILED: 'เครดิตไม่ผ่าน',
  UNREACHABLE: 'ติดต่อไม่ได้',
  OTHER: 'อื่น ๆ',
};

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
}

/** เส้นทางการซื้อ — ตรงกับ customer_journey_states.path VARCHAR(18) */
export type JourneyPath = 'UNKNOWN' | 'INSTALLMENT' | 'CASH' | 'EXTERNAL_FINANCE';
export type JourneyStepState = 'done' | 'current' | 'skipped' | 'todo';

export interface JourneyStep {
  stage: JourneyStage;
  label: string;
  /** ISO เวลาเข้าขั้น · null = ยังไม่ถึง/ข้าม */
  at: string | null;
  state: JourneyStepState;
  /** MANUAL = ขั้นนี้มาจากบันทึกมือ (เว็บติดป้าย "พนักงานบันทึก") */
  evidence: 'SYSTEM' | 'MANUAL';
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
