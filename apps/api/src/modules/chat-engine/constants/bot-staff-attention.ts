/**
 * คำขอของบอทให้ "พนักงานตามต่อ" โดยบอทยังตอบลูกค้าต่อ (notify_staff — คำตัดสิน 2026-09-22)
 *
 * notify_staff ปักธงให้ทีมงานเห็นในกล่องข้อความ แต่ **ไม่ตั้ง `chatRoom.handoffMode`**
 * (ตั้ง = บอทเงียบทั้งห้องจนพนักงานกดคืน — ลูกค้ากดปุ่มที่บอทเพิ่งถามแล้วไม่มีใครตอบ)
 * ⇒ ห้องที่มีคำขอนี้ = `handoffMode = false` + `handoffReason` ขึ้นต้นด้วย prefix ข้างล่าง
 *
 * ไฟล์นี้เป็นแหล่งเดียวของ prefix — ตัวปักธง (sales-bot notify_staff) และตัวที่ต้องไม่ลบคำขอนี้
 * (HandoffManagerService / ด่านโควต้าของ AiAutoReplyService) อ่านค่าเดียวกัน
 */
export const BOT_STAFF_ATTENTION_PREFIX = '[บอทขอให้พนักงานตามต่อ]';

/** คำขอที่เก่ากว่านี้ถือว่าจบไปแล้ว (assignment.resolve ปิดห้องโดยไม่ล้าง handoffReason) */
export const BOT_STAFF_ATTENTION_TTL_MS = 24 * 60 * 60 * 1000;

/** ห้องนี้มีคำขอของบอทให้พนักงานตามต่อที่ยังไม่หมดอายุ และยังไม่ได้ถูกส่งต่อพนักงานเต็มตัว */
export function hasPendingBotStaffAttention(
  room:
    | { handoffMode?: boolean | null; handoffReason?: string | null; handoffTaggedAt?: Date | null }
    | null
    | undefined,
  now: Date = new Date(),
): boolean {
  if (!room || room.handoffMode) return false;
  const reason = room.handoffReason?.trim() ?? '';
  if (!reason.startsWith(BOT_STAFF_ATTENTION_PREFIX)) return false;
  // ไม่มีเวลาปักธง = ถือว่ายังไม่หมดอายุ (ข้อมูลที่ตั้งมือ/ตัวปักธงรุ่นแรก)
  if (!room.handoffTaggedAt) return true;
  return now.getTime() - new Date(room.handoffTaggedAt).getTime() <= BOT_STAFF_ATTENTION_TTL_MS;
}

/**
 * เหตุผลของการส่งต่อพนักงานรอบใหม่ — ถ้าห้องยังค้างคำขอของบอท (เช่น "ขอดูรูปเครื่องจริง iPhone 15")
 * ต่อท้ายไว้ ไม่เขียนทับ: พนักงานต้องเห็นทั้ง "ทำไมบอทหยุด" และ "บอทขอให้ทำอะไรไว้"
 */
export function mergeWithBotStaffAttention(
  reason: string,
  room:
    | { handoffMode?: boolean | null; handoffReason?: string | null; handoffTaggedAt?: Date | null }
    | null
    | undefined,
  now: Date = new Date(),
): string {
  if (!hasPendingBotStaffAttention(room, now)) return reason;
  const pending = room!.handoffReason!.trim();
  if (reason.includes(pending)) return reason;
  return `${reason} · ${pending}`;
}
