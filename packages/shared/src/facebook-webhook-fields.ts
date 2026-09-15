/**
 * ชุด webhook field ที่เพจ Facebook ต้อง subscribe — **แหล่งความจริงเดียว**
 * ใช้ทั้งค่า default ของ API (`facebook-app-review.service.ts`) และค่าตั้งต้นในช่องกรอก
 * ของหน้า Integration Hub (`FacebookAppReviewPanel.tsx`) — ห้ามมีสำเนาที่สอง
 *
 * 🔴 `POST /{page}/subscribed_apps` ของ Meta เป็นการ **เขียนทับทั้งชุด ไม่ใช่เพิ่มเข้าไป**
 * ⇒ ใครก็ตามที่ยิง endpoint นี้ด้วยรายการที่ขาดฟิลด์ใดไป = ถอดฟิลด์นั้นออกเงียบ ๆ
 * (2026-09-12 เจอ `tools/fb-app-review-smoke.sh` ยิงโดยไม่มี `messaging_referrals`
 * ซึ่งจะทำให้ระบบเลิกรู้ที่มาโฆษณาของลูกค้าเก่าทันทีที่มีคนรันสคริปต์)
 *
 * - `messages` = ข้อความลูกค้าเข้า inbox (ลูกค้าใหม่ referral จากโฆษณามากับตัวนี้)
 * - `messaging_postbacks` = กดปุ่ม/เมนูถาวร (referral ของลูกค้าใหม่มากับตัวนี้ได้เช่นกัน)
 * - `messaging_referrals` = ลูกค้าเก่ากลับมาจากโฆษณา/ลิงก์ m.me — ขาดแล้วไม่รู้ที่มาเลย
 * - `message_echoes` = ข้อความที่พนักงานตอบจากกล่องข้อความของเพจเอง (Meta Business Suite /
 *   แอป Page มือถือ) — ตัวรับ webhook เก็บเป็นข้อความ STAFF
 *   (`facebook-webhook.controller.ts` processEchoEvent → `mirrorOutbound`) และเป็น
 *   **ร่องรอยอัตโนมัติทางเดียว** ของการตอบนอกระบบเรา: ล้างสถานะ "รอตอบ" (`clearWaiting`),
 *   หยุด AI ห้องนั้นเมื่อพนักงานเข้ามาคุยเอง, และนับเป็น "ร้านตอบ" ในไทม์ไลน์ลูกค้า (CHAT_DAY)
 *   ⇒ ขาดแล้ว ห้องที่ตอบไปแล้วค้าง "รอตอบ" ตลอด · บอทตอบแทรกพนักงาน · ไทม์ไลน์ไม่เห็นว่าร้านตอบ
 *   (prod ราว 4,600 แถว STAFF จาก echo ต่อ 7 วัน)
 * - `message_deliveries` / `message_reads` = คงไว้ตามที่ยื่น App Review
 *   (ตัวรับ webhook วันนี้ไม่ได้ใช้ — `processMessagingEvent` ข้ามสองชนิดนี้)
 * - **ไม่มี `feed` โดยตั้งใจ** — ตัวรับ webhook อ่านเฉพาะ `entry.messaging`
 *   ไม่เคยอ่าน `entry.changes` ⇒ subscribe `feed` ไปก็ไม่มีอะไรรับ ได้แค่ทราฟฟิกเปล่า
 */
export const FACEBOOK_PAGE_SUBSCRIBED_FIELDS = [
  'messages',
  'messaging_postbacks',
  'messaging_referrals',
  'message_echoes',
  'message_deliveries',
  'message_reads',
] as const;

export type FacebookPageSubscribedField = (typeof FACEBOOK_PAGE_SUBSCRIBED_FIELDS)[number];

/** รูป comma-separated ที่ส่งเข้า `subscribed_fields` ของ Graph API ตรง ๆ */
export const FACEBOOK_PAGE_SUBSCRIBED_FIELDS_CSV: string =
  FACEBOOK_PAGE_SUBSCRIBED_FIELDS.join(',');

/**
 * รวมรายการที่ผู้เรียกส่งมากับชุดบังคับ — ชุดบังคับครบเสมอ (เรียงตามลำดับมาตรฐาน)
 * ฟิลด์เพิ่มเติมที่ผู้เรียกใส่มาต่อท้าย · ตัดช่องว่าง/ค่าว่าง/ตัวซ้ำ
 *
 * เหตุผล: เพราะ subscribed_apps เขียนทับทั้งชุด ช่องกรอกที่แก้เองได้ (หรือแท็บเบราว์เซอร์
 * ที่ยังถือ bundle เก่า) ต้องไม่มีทางถอด `message_echoes` / `messaging_referrals` ออกจากเพจจริง
 * — ถ้าวันหนึ่งต้องการถอดฟิลด์ใดจริง ให้แก้ `FACEBOOK_PAGE_SUBSCRIBED_FIELDS` ไม่ใช่ส่งรายการสั้นมา
 */
export function withRequiredFacebookPageFields(input?: string | null): string {
  const extras = (input ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  return Array.from(new Set<string>([...FACEBOOK_PAGE_SUBSCRIBED_FIELDS, ...extras])).join(',');
}
