import { LINE_FINANCE_NOT_VERIFIED_MESSAGE } from '../line-oa/services/finance-line-link';
import type { ComplianceBlockReason } from './compliance.service';
import { LEGACY_LINK_GRACE_BLOCK_REASON } from './legacy-link-grace';

/**
 * Task 34 ข้อ 2 — ผลของการส่งที่**พนักงานกดเอง** (`NotificationsService.send` → `{ status, blockReason }`) แปลเป็น "ส่งแล้ว" หรือ
 * "ไม่ได้ส่ง พร้อมเหตุผลภาษาไทย" ให้หน้าเว็บแสดง · เดิมผู้เรียกนับทุกครั้งที่ `send()` ไม่ throw เป็นส่งแล้ว ⇒ ข้อความที่ถูกระงับ
 * (`BLOCKED`) · รอเวลาทำการ (`DELAYED`) · ส่ง LINE ไม่ผ่านแล้วเข้าคิวส่งซ้ำ (`FAILED`) ขึ้นว่าส่งสำเร็จ
 *
 * "ส่งแล้ว" = `SENT` เท่านั้น (รวม LINE ไม่ผ่านแล้วส่ง SMS แทนได้ — `send()` คืน `SENT`)
 */
export type NotSentReason =
  | ComplianceBlockReason
  | typeof LEGACY_LINK_GRACE_BLOCK_REASON
  /** ถูกระงับด้วยเหตุผลที่ไม่อยู่ในรายการนี้ */
  | 'BLOCKED'
  /** ส่งทาง LINE ไม่ผ่าน (และไม่มี/ส่ง SMS แทนไม่ผ่าน) — `send()` ตั้งให้คิวส่งซ้ำลองใหม่เอง */
  | 'DELIVERY_FAILED'
  /** ลูกค้าไม่มีแถว OTP ที่ยังผูก — ไม่มีปลายทาง LINE การเงิน */
  | 'NO_RECIPIENT'
  /** `send()` throw — ไม่รู้ผล */
  | 'SEND_ERROR';

/**
 * เหตุผลภาษาไทย — ขึ้นต้นด้วยผล ("ไม่ได้ส่ง" / "ยังไม่ได้ส่ง" = ระบบส่งเองภายหลัง) แล้วทางที่ทำได้จริง:
 * - นอกเวลา: คิวส่งซ้ำตรวจกติกาอีกครั้งแล้วส่งเมื่อเข้าเวลา (`processRetryQueue` — แถว `DELAYED`) · เวลาตาม `business-hours.util.ts`
 * - เพดานวันละครั้ง (พ.ร.บ.ทวงถามหนี้ ม.9 — นับทุกช่องทางของสัญญา) ⇒ ไม่ชวนโทรวันเดียวกัน
 * - ไม่มีความยินยอม: ผู้ทวงโทรหาลูกค้าจากคิวทวงถามได้ (ปุ่มโทร/บันทึกการโทร)
 * - ไม่มีปลายทาง: ข้อความเดิมของระบบ (`LINE_FINANCE_NOT_VERIFIED_MESSAGE`)
 */
export const NOT_SENT_REASON_TEXT: Record<NotSentReason, string> = {
  OUTSIDE_HOURS:
    'ยังไม่ได้ส่ง — นอกเวลาทวงถามตามกฎหมาย (วันธรรมดา 08:00–20:00 น. · วันหยุด 08:00–18:00 น.) ระบบเก็บไว้ส่งให้เองเมื่อถึงเวลา',
  NO_CONSENT:
    'ไม่ได้ส่ง — ลูกค้ายังไม่ได้ให้ความยินยอม PDPA ระบบจึงไม่ส่งข้อความทวง · ติดต่อลูกค้าทางโทรศัพท์แทน',
  FREQUENCY_CAP:
    'ไม่ได้ส่ง — วันนี้สัญญานี้ได้ข้อความทวงไปแล้ว (ทวงได้วันละ 1 ครั้งต่อสัญญา) · ส่งใหม่ได้พรุ่งนี้',
  // ปัจจุบัน `canSend` ไม่คืนค่านี้ (วันหยุดใช้ช่วงเวลา 08:00–18:00 น. ผ่าน OUTSIDE_HOURS) — ข้อความตรงกติกาเดียวกันไว้ก่อนหากมีผู้คืนในอนาคต
  HOLIDAY_BLOCK:
    'ไม่ได้ส่ง — วันหยุดส่งข้อความทวงได้เฉพาะ 08:00–18:00 น. · ส่งใหม่ได้ในช่วงเวลานั้น',
  [LEGACY_LINK_GRACE_BLOCK_REASON]:
    'ไม่ได้ส่ง — สัญญาลูกค้าเก่าอยู่ในช่วงผ่อนผัน 7 วันหลังผูก LINE ระบบจึงไม่ส่งข้อความทวง',
  // เหตุผลอื่นที่ไม่อยู่ในรายการ (กรณีจริง: แม่แบบถูกปิดใช้ `TEMPLATE_INACTIVE` — หน้าแม่แบบยังไม่มีปุ่มเปิดใช้ จึงไม่ชี้ไปที่นั่น) ·
  // ทางที่มีจริงของผู้เห็นข้อความ (คิวทวงถาม / inbox — ปุ่มโทรและบันทึกการโทร) = โทรหาลูกค้า
  BLOCKED: 'ไม่ได้ส่ง — ระบบระงับข้อความนี้ · ติดต่อลูกค้าทางโทรศัพท์แทน',
  DELIVERY_FAILED: 'ยังไม่ได้ส่ง — ส่งทาง LINE ไม่ผ่าน ระบบจะลองส่งใหม่อัตโนมัติ',
  NO_RECIPIENT: LINE_FINANCE_NOT_VERIFIED_MESSAGE,
  SEND_ERROR: 'ไม่ได้ส่ง — ระบบส่งข้อความไม่ผ่าน กรุณาลองใหม่',
};

export type SendOutcome =
  | { sent: true }
  | { sent: false; reason: NotSentReason; reasonText: string };

/** เหตุผลที่ด่านของ `send()` ส่งกลับมาใน `blockReason` (compliance + ช่วงผ่อนผัน) */
const BLOCK_REASONS: ReadonlySet<string> = new Set<NotSentReason>([
  'OUTSIDE_HOURS',
  'NO_CONSENT',
  'FREQUENCY_CAP',
  'HOLIDAY_BLOCK',
  LEGACY_LINK_GRACE_BLOCK_REASON,
]);

function notSent(reason: NotSentReason): SendOutcome {
  return { sent: false, reason, reasonText: NOT_SENT_REASON_TEXT[reason] };
}

/** เหตุผลที่ไม่ได้ส่งของการเรียกที่ไม่ถึง `send()` (ไม่มีปลายทาง / throw) */
export function notSentOutcome(reason: 'NO_RECIPIENT' | 'SEND_ERROR'): SendOutcome {
  return notSent(reason);
}

/**
 * ผลของ `NotificationsService.send` → ส่งแล้ว / ไม่ได้ส่งพร้อมเหตุผล · `DELAYED` = นอกเวลาทำการ (ด่านเดียวที่ทำให้เลื่อน) ·
 * `FAILED` = ส่งไม่ผ่าน: ผู้เรียกปกติ `send()` ตั้งคิวส่งซ้ำให้ (`DELIVERY_FAILED`) · ผู้เรียกที่ส่ง `noRetry: true` (ส่งซ้ำกฎทวงด้วยมือ —
 * `DunningRetryService`) ไม่เข้าคิว ⇒ `queuedForRetry: false` = `SEND_ERROR` (ไม่บอกว่าระบบจะลองใหม่เอง) ·
 * สถานะอื่น (`BLOCKED` · `SKIPPED`) = เหตุผลจาก `blockReason` ถ้ารู้จัก
 */
export function describeSendOutcome(
  result: { status: string; blockReason?: string | null },
  opts: { queuedForRetry?: boolean } = {},
): SendOutcome {
  if (result.status === 'SENT') return { sent: true };
  if (result.status === 'DELAYED') return notSent('OUTSIDE_HOURS');
  if (result.status === 'FAILED') {
    return notSent(opts.queuedForRetry === false ? 'SEND_ERROR' : 'DELIVERY_FAILED');
  }
  const reason = result.blockReason;
  return notSent(reason && BLOCK_REASONS.has(reason) ? (reason as NotSentReason) : 'BLOCKED');
}

/**
 * ช่องเหตุผลสำหรับคำตอบของ endpoint ที่พนักงานกดส่ง (`POST notifications/send-from-template` · `notifications/bulk`) — ไม่ได้ส่ง =
 * `notSentReason` + `reasonText` · ส่งแล้ว = ไม่มีช่อง (คำตอบเดิม)
 */
export interface NotSentFields {
  notSentReason?: NotSentReason;
  reasonText?: string;
}

export function notSentFields(outcome: SendOutcome): NotSentFields {
  return outcome.sent ? {} : { notSentReason: outcome.reason, reasonText: outcome.reasonText };
}
