import { z } from 'zod';
import type { JourneyEntryKind, JourneySystemEntryKind } from '@installment/shared';

/**
 * whitelist ของคอลัมน์ `customer_journey_entries.data` ต่อ kind (PDPA) — สัญญากลางฉบับเดียวของแผน การเดินทางของลูกค้า
 * - คีย์ที่ไม่ประกาศถูกตัดทิ้ง (z.object ค่าตั้งต้น = strip) ⇒ ผู้เรียกส่งของเกินมาก็ไม่ลงฐาน
 * - ห้ามมีช่องข้อความอิสระ: ใช้รายการปิด (enum) · ตัวเลข · uuid · เลขเอกสารเท่านั้น
 * - ห้ามเก็บข้อความแชท, เหตุผลส่งต่อแบบข้อความ, callLog.notes, เบอร์, เลขบัตร, ที่อยู่, lineUserId/PSID, reviewNotes, aiSummary/aiRecommendation
 * - เอกสารอ้างผ่าน refType/refId ของแถว ไม่ใช่ data
 * บันทึกมือ (MANUAL) เก็บค่าในคอลัมน์ channel/outcome/lostReason/heardFrom/note ของตัวเอง ⇒ data ว่าง
 */

export const HANDOFF_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type HandoffPriority = (typeof HANDOFF_PRIORITIES)[number];
/** เหตุผลส่งต่อแบบรหัสปิด — Task 6 แปลงข้อความจากโค้ดเป็นรหัส ข้อความที่ไม่รู้จัก = OTHER (ไม่เก็บข้อความเด็ดขาด) */
export const HANDOFF_REASON_CODES = [
  'BOT_SEND_FAILED',
  'LOW_CONFIDENCE',
  'AI_ERROR',
  'CUSTOMER_REQUEST',
  'OTHER',
] as const;
export type HandoffReasonCode = (typeof HANDOFF_REASON_CODES)[number];
export const CONTACT_FIELDS = ['phone', 'nationalId'] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
/** UPDATE = PATCH /customers/:id · FILL_CONTACT = POST /customers/:id/fill-contact · CAPTURE_LEAD = บอทขาย capture_lead เติมเบอร์หลักให้ลูกค้าที่ยังไม่มีเบอร์ (capture-lead.tool.ts, R25) */
export const CONTACT_ADDED_VIA = ['UPDATE', 'FILL_CONTACT', 'CAPTURE_LEAD'] as const;
export type ContactAddedVia = (typeof CONTACT_ADDED_VIA)[number];
export const LINE_LINK_CHANNELS = ['FINANCE', 'SHOP'] as const;
export type LineLinkChannel = (typeof LINE_LINK_CHANNELS)[number];
/** VERIFICATION = OTP ของบอทการเงิน · LIFF = ลงทะเบียน LINE การเงินผ่าน LIFF · SELF_LINK_PHONE = พิมพ์เบอร์ใน LINE ร้าน */
export const LINE_LINKED_VIA = ['VERIFICATION', 'LIFF', 'SELF_LINK_PHONE'] as const;
export type LineLinkedVia = (typeof LINE_LINKED_VIA)[number];
export const CREDIT_CHECK_OPENED_VIA = ['CONTRACT', 'CUSTOMER'] as const;
export type CreditCheckOpenedVia = (typeof CREDIT_CHECK_OPENED_VIA)[number];
export const CONTRACT_REVIEW_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export const CREDIT_AI_STATUSES = ['APPROVED', 'MANUAL_REVIEW', 'REJECTED'] as const;
/** ใบรับเครื่องคืน (spec 2026-09-20 §5.6) — รหัสปิดของ DeviceReturnKind + REPOSSESSION_RETURN_REASONS; ห้ามราคา/เกรด/หมายเหตุ */
export const DEVICE_RETURN_KINDS = ['VOLUNTARY', 'REPOSSESSION'] as const;
export const DEVICE_RETURN_REASONS = [
  'UNAFFORDABLE',
  'NO_LONGER_NEEDED',
  'AFTER_TERMINATION',
  'OTHER',
] as const;

/** เลขสัญญา (BCP2609-00042 จาก utils/sequence.util.ts:19 · เลขนำเข้าเดิม) — ไม่ใช่ข้อมูลส่วนบุคคล แต่ห้ามช่องว่าง/ภาษาไทย กันข้อความอิสระ */
const contractNumber = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/);

const noData = z.object({});

export const JOURNEY_DATA_SCHEMAS: Readonly<Record<JourneyEntryKind, z.ZodTypeAny>> = {
  // SYSTEM
  CONTRACT_ACTIVATED: z.object({
    contractNumber,
    totalMonths: z.number().int().min(1).max(120),
    monthlyPayment: z.number().min(0).max(10_000_000),
  }),
  CONTRACT_REVIEWED: z.object({ decision: z.enum(CONTRACT_REVIEW_DECISIONS), contractNumber }),
  DEVICE_RETURNED: z.object({
    docNumber: z.string().max(20),
    contractNumber,
    returnKind: z.enum(DEVICE_RETURN_KINDS),
    returnReason: z.enum(DEVICE_RETURN_REASONS),
  }),
  /** ปิดสัญญาก่อนกำหนด (JP4, 2026-09-24) — เลขใบเสร็จ RT-YYYYMM-NNNNN (null = ออกใบไม่สำเร็จ) + ยอดปิด; ห้ามข้อความอิสระ/ส่วนลด/ช่องทาง */
  EARLY_PAYOFF: z.object({
    contractNumber,
    receiptNumber: z
      .string()
      .regex(/^[A-Z]{2}-\d{6}-\d{5}$/)
      .nullable(),
    totalPayoff: z.number().min(0).max(10_000_000),
  }),
  CREDIT_CHECK_OPENED_BY: z.object({ via: z.enum(CREDIT_CHECK_OPENED_VIA) }),
  CREDIT_AI_SCORED: z.object({
    score: z.number().int().min(0).max(100).nullable(),
    status: z.enum(CREDIT_AI_STATUSES),
  }),
  BOT_HANDOFF: z.object({
    priority: z.enum(HANDOFF_PRIORITIES),
    reasonCode: z.enum(HANDOFF_REASON_CODES),
  }),
  CONTACT_ADDED: z.object({
    fields: z.array(z.enum(CONTACT_FIELDS)).min(1).max(2),
    via: z.enum(CONTACT_ADDED_VIA),
  }),
  LINE_LINKED: z.object({
    channel: z.enum(LINE_LINK_CHANNELS),
    via: z.enum(LINE_LINKED_VIA),
  }),
  PRODUCT_LINK_CLICK: z.object({ productId: z.string().uuid() }),
  PLACEHOLDER_MERGED: z.object({ roomCount: z.number().int().min(0).max(1000) }),
  // MANUAL
  TOUCHPOINT: noData,
  HEARD_FROM: noData,
  MARKED_LOST: noData,
  REOPENED: noData,
};

export type JourneyDataSanitizeResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; issues: string[] };

/** ตรวจ + ตัด data ตาม kind · issues เป็น "path:code" เท่านั้น (ห้ามพาค่าจริงไป log/Sentry) · ไม่โยน */
export function sanitizeJourneyData(kind: string, raw: unknown): JourneyDataSanitizeResult {
  if (!Object.prototype.hasOwnProperty.call(JOURNEY_DATA_SCHEMAS, kind)) {
    return { ok: false, issues: ['kind:unknown'] };
  }
  const parsed = JOURNEY_DATA_SCHEMAS[kind as JourneyEntryKind].safeParse(raw ?? {});
  if (parsed.success) {
    return { ok: true, data: parsed.data as Record<string, unknown> };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}:${issue.code}`),
  };
}

/**
 * รูป dedupe_key เดียวทั้งระบบ: `${kind}:${ส่วนอ้างอิง…}` (ตาราง "สัญญา data + dedupeKey" ใน Task 2)
 * ส่วนอ้างอิง = id เอกสาร/ห้อง/ลูกค้าตอนเขียน + เวลาของเหตุการณ์เมื่อเกิดซ้ำได้หลายรอบ · ห้ามใส่เบอร์ LINE user id หรือ PSID
 */
export function journeyDedupeKey(
  kind: JourneySystemEntryKind,
  ...parts: Array<string | number>
): string {
  const texts = parts.map((part) => String(part));
  if (texts.length === 0 || texts.some((part) => part.trim() === '')) {
    throw new Error(`journeyDedupeKey(${kind}): ต้องมีส่วนอ้างอิงที่ไม่ว่างอย่างน้อยหนึ่งส่วน`);
  }
  return [kind, ...texts].join(':');
}
