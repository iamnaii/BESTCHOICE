import type { InboxFilters } from './ConversationList';

/** พารามิเตอร์ GET /staff-chat/rooms จากตัวกรองของกล่องข้อความ — แยกออกมาให้เทสต์ได้เป็นตาราง
 *  กติกา: แท็บ "ของฉัน" ล็อกผู้ดูแลเป็นตัวเอง (เมนูผู้ดูแลไม่มีผล) · รอตอบ/ตอบไม่ทัน เป็นคนละกองฝั่งเซิร์ฟเวอร์
 *  · ช่องทางส่งเป็น channels (CSV) เพราะเซิร์ฟเวอร์ประกอบมันด้วย AND ร่วมกับเงื่อนไขอื่น */
export function buildRoomListParams(filters: InboxFilters, currentUserId?: string) {
  const mine = filters.tab === 'mine';
  const staffPick = filters.who !== 'all' && filters.who !== 'free' ? filters.who : undefined;
  return {
    search: filters.search || undefined,
    assignedToId: mine ? currentUserId : staffPick,
    // ของฉัน = งานที่ยังเปิดของฉัน — ห้องที่ปิดงานแล้วดูได้ใน "ทั้งหมด" (ท้ายรายการ)
    openOnly: mine ? true : undefined,
    unassignedOnly: !mine && filters.who === 'free' ? true : undefined,
    waiting: filters.tab === 'waiting' && filters.view !== 'expired' ? true : undefined,
    expired: filters.tab === 'waiting' && filters.view === 'expired' ? true : undefined,
    channels: filters.channel ?? undefined,
  };
}
