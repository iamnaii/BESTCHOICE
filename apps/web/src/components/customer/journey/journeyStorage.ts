import { JOURNEY_RECORDABLE_TOUCH_CHANNELS, type JourneyRecordableTouchChannel } from '@installment/shared';

/**
 * ค่าที่จำไว้ในเบราว์เซอร์ของผู้ใช้คนนี้ — ความสะดวกเฉพาะคน ไม่ใช่ข้อมูลธุรกิจ
 * ทุกการอ่าน/เขียนครอบ try/catch: โหมดส่วนตัว · ที่เก็บเต็ม · ถูกบล็อก ต้องไม่ทำให้หน้าพัง
 * (pattern Customer360Panel `inbox360.collapsed.v1`)
 */
const LAST_CHANNEL_KEY = 'customerJourney.lastChannel.v1';
const HEARD_FROM_SKIPPED_KEY_PREFIX = 'customerJourney.heardFromSkipped.v1:';

function isRecordableChannel(value: string | null): value is JourneyRecordableTouchChannel {
  return value !== null && (JOURNEY_RECORDABLE_TOUCH_CHANNELS as readonly string[]).includes(value);
}

/** ช่องทางที่บันทึกสำเร็จล่าสุด — ค่าที่ไม่ใช่ 4 ช่องทางที่บันทึกได้ (รวม OTHER) ถือว่าไม่เคยจำ */
export function readLastChannel(): JourneyRecordableTouchChannel | null {
  try {
    const raw = localStorage.getItem(LAST_CHANNEL_KEY);
    return isRecordableChannel(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** เรียกหลังบันทึกสำเร็จ (201) เท่านั้น */
export function writeLastChannel(channel: JourneyRecordableTouchChannel): void {
  if (!isRecordableChannel(channel)) return;
  try {
    localStorage.setItem(LAST_CHANNEL_KEY, channel);
  } catch {
    // ที่เก็บใช้ไม่ได้ — ครั้งหน้าแค่ไม่มีช่องทางเลือกไว้ก่อน
  }
}

/** กด "ข้าม" ที่ป้ายรู้จักร้านจากไหนของลูกค้าคนนี้ในเซสชันนี้แล้วหรือยัง */
export function isHeardFromSkipped(customerId: string): boolean {
  try {
    return sessionStorage.getItem(HEARD_FROM_SKIPPED_KEY_PREFIX + customerId) === '1';
  } catch {
    return false;
  }
}

/** ซ่อนเฉพาะเซสชันนี้ — ปิดแท็บเบราว์เซอร์แล้วเปิดหน้าใหม่ ป้ายขึ้นอีก ("จนกว่าจะตอบ") */
export function markHeardFromSkipped(customerId: string): void {
  try {
    sessionStorage.setItem(HEARD_FROM_SKIPPED_KEY_PREFIX + customerId, '1');
  } catch {
    // ที่เก็บใช้ไม่ได้ — ผู้เรียกยังซ่อนด้วย state ของหน้าได้เอง
  }
}
