type Room = { assignedTo?: { id: string } | null; waitingSince?: string | null; resolvedAt?: string | null };

/** ตัวนับสำรองฝั่งจอ ใช้เมื่อยังไม่ได้คำตอบจาก GET /staff-chat/rooms/counts
 *  (ตัวเลขจากเซิร์ฟเวอร์เป็นตัวจริงเสมอ เพราะนับทั้งจักรวาลห้อง ไม่ใช่แค่หน้าที่โหลดมา)
 *
 *  กติกาเดียวกับฝั่งเซิร์ฟเวอร์: ป้ายแต่ละใบต้องนับ "จำนวนแถวที่แท็บนั้นแสดง"
 *  ก่อน 2026-09-05 ทุกใบกรองด้วย unreadCount > 0 ⇒ "ทั้งหมด" รายงานห้องที่ยังไม่อ่าน
 *  และ "ของฉัน" นับเฉพาะห้องของฉันที่ยังไม่อ่าน — ตรงกับบั๊กฝั่ง getRoomBadgeCounts เป๊ะ ๆ */
export function deriveTabCounts(
  sessions: Room[],
  currentUserId?: string,
): { mine: number; all: number; waiting: number } {
  const all = sessions.length;
  const mine = currentUserId
    ? sessions.filter((r) => r.assignedTo?.id === currentUserId && !r.resolvedAt).length
    : 0;
  const waiting = sessions.filter((r) => !!r.waitingSince).length;
  return { mine, all, waiting };
}

type ChannelRoom = { channel?: string };

/** จำนวนห้องต่อช่องทาง จากรายการที่โหลดมาแล้ว — ซึ่งถูกกรองด้วยแท็บที่เปิดอยู่ไปแล้ว
 *  จึงนับทุกแถวที่เห็น ไม่ใช่เฉพาะห้องที่ยังไม่อ่าน (ชิปกรองทับแท็บ ไม่ใช่กรองความอ่าน)
 *  ช่องทางที่ไม่มีห้องเลยถูกตัดออก */
export function deriveChannelCounts(sessions: ChannelRoom[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of sessions) {
    if (r.channel) out[r.channel] = (out[r.channel] ?? 0) + 1;
  }
  return out;
}
