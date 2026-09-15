import { Prisma } from '@prisma/client';
import { CHAT_SOURCE_PREFIX, type JourneyEvent } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { formatDateTime } from '../../../utils/thai-date.util';
import { roomAssignmentScope } from '../../credit-check/services/room-credit-access';
import { JOURNEY_CHAT_ROLES, asRecord, bahtText, dbTimeRange, finalizeSource, scanTake, staffActor, type JourneyActor, type JourneySource, type JourneyWindow } from './journey-window';

export const CHAT_CHANNEL_LABELS: Record<string, string> = { FACEBOOK: 'Facebook', LINE_SHOP: 'LINE ร้าน', LINE_FINANCE: 'LINE การเงิน', TIKTOK: 'TikTok', WEB: 'เว็บ' };

interface ChatDayRow { roomId: string; day: string; customer: number; staff: number; bot: number; firstCustomerAt: Date | null; lastAt: Date }

/** นับแถวอย่างเดียว ไม่อ่าน text/media · รวมแถวที่ retention soft-delete · created_at = timestamp(3) เก็บ UTC · ไม่มี LIMIT (หลักร้อยวันต่อคน) ตัดใน finalizeSource */
function chatDays(prisma: PrismaService, roomIds: string[]): Promise<ChatDayRow[]> {
  return prisma.$queryRaw<ChatDayRow[]>`
    SELECT m.room_id AS "roomId",
           to_char(((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS "day",
           (COUNT(*) FILTER (WHERE m.role = 'CUSTOMER'))::int AS "customer",
           (COUNT(*) FILTER (WHERE m.role = 'STAFF'))::int AS "staff",
           (COUNT(*) FILTER (WHERE m.role = 'BOT'))::int AS "bot",
           MIN(m.created_at) FILTER (WHERE m.role = 'CUSTOMER') AS "firstCustomerAt",
           MAX(m.created_at) AS "lastAt"
      FROM chat_messages m
     WHERE m.room_id IN (${Prisma.join(roomIds)}) AND m.role IN ('CUSTOMER', 'STAFF', 'BOT')
     GROUP BY 1, 2`;
}

async function roomEvents(prisma: PrismaService, customerIds: string[], actor: JourneyActor): Promise<JourneyEvent[]> {
  // รวมห้องที่ soft-delete (mergeRooms) · SALES เห็นเฉพาะห้องที่ยังไม่มีผู้ดูแลหรือตัวเองดูแล
  const rooms = await prisma.chatRoom.findMany({ where: { customerId: { in: customerIds }, ...roomAssignmentScope(actor) }, select: { id: true, channel: true, createdAt: true } });
  if (!rooms.length) return [];
  const roomIds = rooms.map((room) => room.id);
  const [days, todos] = await Promise.all([
    chatDays(prisma, roomIds),
    prisma.todo.findMany({
      where: { roomId: { in: roomIds }, dueDate: { not: null }, deletedAt: null },
      select: { id: true, roomId: true, dueDate: true, createdAt: true, completedAt: true, createdBy: { select: { id: true, name: true } } },
    }),
  ]);
  const firstCustomerAt = new Map<string, Date>();
  for (const row of days) {
    const seen = firstCustomerAt.get(row.roomId);
    if (row.firstCustomerAt && (!seen || row.firstCustomerAt < seen)) firstCustomerAt.set(row.roomId, row.firstCustomerAt);
  }
  const opened = rooms
    .map((room) => {
      const first = firstCustomerAt.get(room.id);
      const at = first && first < room.createdAt ? first : room.createdAt;
      return { room, at, imported: at !== room.createdAt };
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.room.id < b.room.id ? -1 : 1));

  const events: JourneyEvent[] = opened.map(({ room, at, imported }, index): JourneyEvent => ({
    id: `chatroom-${room.id}`, type: 'CHAT_ROOM_OPENED', group: 'chat', stage: index === 0 ? 'CONTACTED' : null, timestamp: at.toISOString(),
    title: `${index === 0 ? 'ทักแชทครั้งแรกทาง' : 'ทักเพิ่มทาง'} ${CHAT_CHANNEL_LABELS[room.channel] ?? room.channel}`,
    actor: { type: 'CUSTOMER' }, reliability: imported ? 'approximate' : 'exact', origin: 'SOURCE', href: `/inbox/${room.id}`, metadata: { channel: room.channel },
  }));
  for (const row of days) {
    const parts = [row.customer ? `ลูกค้า ${row.customer} ข้อความ` : '', row.staff ? `ร้านตอบ ${row.staff}` : '', row.bot ? `บอท ${row.bot}` : ''].filter(Boolean);
    events.push({
      id: `chatday-${row.roomId}-${row.day}`, type: 'CHAT_DAY', group: 'chat', stage: null, timestamp: row.lastAt.toISOString(), title: `คุยแชท: ${parts.join(' · ')}`, actor: null,
      // ข้อความทักทายอัตโนมัติ FB ถูกเก็บเป็น STAFF ⇒ จำนวนร้านเป็นค่าประมาณ
      reliability: row.staff > 0 ? 'approximate' : 'exact', origin: 'SOURCE', href: `/inbox/${row.roomId}`,
      metadata: { customerMessages: row.customer, staffMessages: row.staff, botMessages: row.bot },
    });
  }
  for (const todo of todos) {
    if (!todo.dueDate || !todo.roomId) continue;
    const href = `/inbox/${todo.roomId}`;
    events.push({ id: `appointment-${todo.id}`, type: 'APPOINTMENT', group: 'chat', stage: 'INTERESTED', timestamp: todo.createdAt.toISOString(), title: `นัดเข้าร้าน ${formatDateTime(todo.dueDate)}`, actor: staffActor(todo.createdBy), reliability: 'exact', origin: 'SOURCE', href });
    if (todo.completedAt) events.push({ id: `appointment-done-${todo.id}`, type: 'APPOINTMENT_DONE', group: 'chat', stage: 'INTERESTED', timestamp: todo.completedAt.toISOString(), title: 'มาตามนัดแล้ว', actor: { type: 'STAFF' }, reliability: 'exact', origin: 'SOURCE', href });
  }
  return events;
}

async function leadEvents(prisma: PrismaService, customerIds: string[], window: JourneyWindow): Promise<JourneyEvent[]> {
  const rows = await prisma.auditLog.findMany({
    where: { action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: { in: customerIds }, createdAt: dbTimeRange(window) },
    select: { id: true, createdAt: true, newValue: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: scanTake(window),
  });
  // newValue มีชื่อ เบอร์ ที่อยู่ — หยิบเฉพาะคีย์ที่ไม่ใช่ข้อมูลส่วนบุคคล
  return rows.map((row): JourneyEvent => {
    const value = asRecord(row.newValue);
    const packageChoice = typeof value.packageChoice === 'string' ? value.packageChoice : null;
    const downAmount = typeof value.downAmount === 'number' ? value.downAmount : null;
    const productId = typeof value.productId === 'string' ? value.productId : null;
    const title = ['บอทจดความสนใจ', packageChoice ? `แพ็ก ${packageChoice}` : '', downAmount !== null ? `ดาวน์ ${bahtText(downAmount)} บาท` : ''].filter(Boolean).join(' · ');
    return { id: `lead-${row.id}`, type: 'AI_LEAD_CAPTURED', group: 'chat', stage: 'INTERESTED', timestamp: row.createdAt.toISOString(), title, actor: { type: 'BOT' }, reliability: 'exact', origin: 'SOURCE', metadata: { packageChoice, downAmount, productId } };
  });
}

async function createdEvents(prisma: PrismaService, customerIds: string[]): Promise<JourneyEvent[]> {
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, createdAt: true, acquisitionSource: true } });
  return customers.filter((c) => !c.acquisitionSource?.startsWith(CHAT_SOURCE_PREFIX)).map((c): JourneyEvent => {
    const byBot = c.acquisitionSource === 'AI_CHAT';
    return {
      id: `customer-${c.id}`, type: byBot ? 'CUSTOMER_CREATED_BY_BOT' : 'CUSTOMER_CREATED_BY_STAFF', group: 'chat', stage: 'IDENTIFIED', timestamp: c.createdAt.toISOString(),
      title: byBot ? 'บอทบันทึกเป็นลูกค้าจากแชท' : 'พนักงานเพิ่มเป็นลูกค้า (หน้าร้าน)', actor: { type: byBot ? 'BOT' : 'STAFF' },
      reliability: 'approximate', origin: 'SOURCE', // revive-ghost / stub-upgrade ใช้ created_at เดิม
    };
  });
}

/** กลุ่ม chat · PDPA: ไม่อ่าน chat_messages.text · todo.title/description · เบอร์/ที่อยู่ใน audit */
export const chatSource: JourneySource = async (prisma, customerIds, window, actor) => {
  if (!JOURNEY_CHAT_ROLES.has(actor.role)) return [];
  const [rooms, leads, created] = await Promise.all([roomEvents(prisma, customerIds, actor), leadEvents(prisma, customerIds, window), createdEvents(prisma, customerIds)]);
  return finalizeSource([...rooms, ...leads, ...created], window);
};
