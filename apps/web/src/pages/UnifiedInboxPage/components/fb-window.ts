/** หน้าต่างตอบ 24 ชม. ของ Facebook Messenger นับจากข้อความ *ล่าสุด* ของลูกค้า (สเปก §8 — เตือน ไม่ปิดปุ่ม)
 *  ช่องทางอื่นไม่มีหน้าต่าง ⇒ ผู้เรียกต้องส่งเฉพาะห้อง FACEBOOK (หรือใช้ fbWindowFor ที่เช็คให้) */
export const FB_WINDOW_MS = 24 * 60 * 60 * 1000;
/** เตือน "ตอบได้อีก N" เมื่อเหลือไม่เกินเท่านี้ — เกณฑ์เดียวกับชั้นแรกของการเรียงคิวฝั่งเซิร์ฟเวอร์ */
export const FB_CLOSING_MS = 3 * 60 * 60 * 1000;

export type FbWindowState = 'open' | 'closing' | 'closed';

function msLeft(lastCustomerAt: string | Date | null | undefined, now: Date): number | null {
  if (!lastCustomerAt) return null;
  const t = new Date(lastCustomerAt).getTime();
  if (Number.isNaN(t)) return null;
  return FB_WINDOW_MS - (now.getTime() - t);
}

/** ไม่มีค่า / วันที่เพี้ยน → 'open' (ไม่เตือนมั่ว) — ฝั่งเซิร์ฟเวอร์ถือ null เป็นพ้นแล้วสำหรับ *การจัดคิว*
 *  แต่ฝั่งจอเมื่อเปิดห้องแล้ว ไม่รู้ = ไม่ขู่ ให้ปุ่มส่งทำงานปกติแล้วรอเหตุจริงจาก Facebook */
export function fbWindowState(lastCustomerAt: string | Date | null | undefined, now: Date = new Date()): FbWindowState {
  const left = msLeft(lastCustomerAt, now);
  if (left === null) return 'open';
  if (left <= 0) return 'closed';
  if (left <= FB_CLOSING_MS) return 'closing';
  return 'open';
}

/** ชั่วโมงที่เหลือ ปัดขึ้น ไม่ติดลบ (ใช้ในข้อความ "ตอบได้อีก N ชม.") */
export function fbWindowHoursLeft(lastCustomerAt: string | Date | null | undefined, now: Date = new Date()): number {
  const left = msLeft(lastCustomerAt, now);
  if (left === null || left <= 0) return 0;
  return Math.ceil(left / (60 * 60 * 1000));
}

/** ข้อความสั้นสำหรับป้าย/แถบ: "50 นาที" · "3 ชม." */
export function fbWindowLeftText(lastCustomerAt: string | Date | null | undefined, now: Date = new Date()): string {
  const left = msLeft(lastCustomerAt, now);
  if (left === null || left <= 0) return '0 นาที';
  const min = Math.ceil(left / 60000);
  return min < 60 ? `${min} นาที` : `${Math.ceil(min / 60)} ชม.`;
}

/** สถานะหน้าต่างของห้อง — ช่องทางที่ไม่ใช่ FACEBOOK คืน 'open' เสมอ (ไม่มีหน้าต่าง) */
export function fbWindowFor(room: { channel?: string | null; lastCustomerAt?: string | Date | null }, now: Date = new Date()): FbWindowState {
  if (room.channel !== 'FACEBOOK') return 'open';
  return fbWindowState(room.lastCustomerAt, now);
}
