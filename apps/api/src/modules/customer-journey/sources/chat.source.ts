import { Prisma } from '@prisma/client';
import { CHAT_SOURCE_PREFIX, JOURNEY_CHAT_CHANNEL_LABELS, chatSourceOf, firstChatContactTitle, type JourneyEvent } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { formatDateTime } from '../../../utils/thai-date.util';
import { roomAssignmentScope } from '../../credit-check/services/room-credit-access';
import { asRecord, bahtText, dbTimeRange, finalizeSource, roleSeesGroup, scanTake, staffActor, type JourneyActor, type JourneySource, type JourneyWindow } from './journey-window';
import { CUSTOMER_DOCUMENT_FILE_FRAGMENT } from '../chat-document-file';
import { formatReplyGap } from './reply-gap';

interface ChatDayRow { roomId: string; day: string; customer: number; staff: number; bot: number; files: number; lastFileAt: Date | null; firstCustomerAt: Date | null; lastAt: Date }

/**
 * นับแถวอย่างเดียว ไม่อ่าน text/media_type และไม่ select media_url · รวมแถวที่ retention soft-delete · created_at = timestamp(3) เก็บ UTC · ไม่มี LIMIT (หลักร้อยวันต่อคน) ตัดใน finalizeSource
 * files/lastFileAt = ไฟล์เอกสารที่ลูกค้าส่ง — เงื่อนไข CUSTOMER_DOCUMENT_FILE_FRAGMENT จาก chat-document-file.ts (ชุดเดียวกับ first_file_at ใน journey-state.sql · คำตัดสินผู้ควบคุม R-P1)
 *   media_url อยู่ใน FILTER เท่านั้น · รูปภาพ / ไฟล์ของร้าน / ไม่มีลิงก์ / ลิงก์แชร์ ไม่นับ · CHAT_DAY ยังนับข้อความลูกค้าทุกชนิด
 */
function chatDays(prisma: PrismaService, roomIds: string[]): Promise<ChatDayRow[]> {
  return prisma.$queryRaw<ChatDayRow[]>`
    SELECT m.room_id AS "roomId",
           to_char(((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS "day",
           (COUNT(*) FILTER (WHERE m.role = 'CUSTOMER'))::int AS "customer",
           (COUNT(*) FILTER (WHERE m.role = 'STAFF'))::int AS "staff",
           (COUNT(*) FILTER (WHERE m.role = 'BOT'))::int AS "bot",
           (COUNT(*) FILTER (WHERE ${CUSTOMER_DOCUMENT_FILE_FRAGMENT}))::int AS "files",
           MAX(m.created_at) FILTER (WHERE ${CUSTOMER_DOCUMENT_FILE_FRAGMENT}) AS "lastFileAt",
           MIN(m.created_at) FILTER (WHERE m.role = 'CUSTOMER') AS "firstCustomerAt",
           MAX(m.created_at) AS "lastAt"
      FROM chat_messages m
     WHERE m.room_id IN (${Prisma.join(roomIds)}) AND m.role IN ('CUSTOMER', 'STAFF', 'BOT')
     GROUP BY 1, 2`;
}

const LOST_MARK_KINDS = ['MARKED_LOST', 'REOPENED'];

/**
 * เอกสารที่ลูกค้าสร้างซึ่งล้างป้ายหลุด — ชุดและเงื่อนไขเดียวกับ doc_last_at ใน sql/journey-state.sql (แก้ที่หนึ่งต้องแก้อีกที่ · chat.recontact.db.spec.ts ตรวจคู่กัน)
 * ช่วง (after, upTo] · ทุกสถานะ · product_reservations ไม่มี deleted_at · คัดแค่ id
 */
async function clearingDocumentBetween(prisma: PrismaService, customerIds: string[], after: Date, upTo: Date): Promise<boolean> {
  const customerId = { in: customerIds };
  const between = { gt: after, lte: upTo };
  const select = { id: true } as const;
  const found = await Promise.all([
    prisma.booking.findFirst({ where: { customerId, deletedAt: null, createdAt: between }, select }),
    prisma.onlineInstallmentApplication.findFirst({ where: { customerId, deletedAt: null, createdAt: between }, select }),
    prisma.productReservation.findFirst({ where: { customerId, reservedAt: between }, select }),
    prisma.tradeIn.findFirst({ where: { customerId, deletedAt: null, createdAt: between }, select }),
    prisma.savingPlan.findFirst({ where: { customerId, deletedAt: null, createdAt: between }, select }),
    prisma.onlineOrder.findFirst({ where: { customerId, deletedAt: null, createdAt: between }, select }),
  ]);
  return found.some(Boolean);
}

/**
 * "กลับมาติดต่ออีกครั้ง" (คำตัดสินเจ้าของ 2026-09-15 ข้อ 6) — คำนวณตอนอ่าน ไม่เก็บ
 * mark ล่าสุดที่ไม่ถูกลบของครอบครัวต้องเป็น MARKED_LOST (กติกาเดียวกับ CTE lost_mark) · ไม่ตัดหน้าต่าง: mark อยู่คนละหน้ากับข้อความได้
 * แถว = ข้อความ CUSTOMER แรกที่เวลา > mark ในห้องที่ผู้ดูเห็น · ไม่กรอง deletedAt ให้ตรงกับ last_customer_at · PDPA: select แค่ roomId + createdAt
 * ไม่ออกแถวเมื่อเอกสารที่ล้างป้ายเกิดใน (mark, ข้อความ] — แถวเอกสารอธิบายแทน · TOUCHPOINT ไม่กันแถว · มีเฉพาะรอบหลุดล่าสุด
 * SALES: ป้ายอาจล้างเพราะข้อความในห้องที่มองไม่เห็น แถวจึงอาจมาช้ากว่าหรือไม่มาเลย (เหมือนแถวแชทอื่น)
 */
async function recontactEvent(prisma: PrismaService, customerIds: string[], roomIds: string[]): Promise<JourneyEvent | null> {
  const mark = await prisma.customerJourneyEntry.findFirst({
    where: { customerId: { in: customerIds }, kind: { in: LOST_MARK_KINDS }, deletedAt: null },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    select: { id: true, kind: true, occurredAt: true },
  });
  if (!mark || mark.kind !== 'MARKED_LOST') return null;
  const back = await prisma.chatMessage.findFirst({
    where: { roomId: { in: roomIds }, role: 'CUSTOMER', createdAt: { gt: mark.occurredAt } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { roomId: true, createdAt: true },
  });
  if (!back || (await clearingDocumentBetween(prisma, customerIds, mark.occurredAt, back.createdAt))) return null;
  return {
    id: `recontact-${mark.id}`, type: 'RECONTACTED', group: 'chat', stage: null, timestamp: back.createdAt.toISOString(),
    title: 'กลับมาติดต่ออีกครั้ง', actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE', href: `/inbox/${back.roomId}`,
  };
}

async function roomEvents(prisma: PrismaService, customerIds: string[], actor: JourneyActor): Promise<JourneyEvent[]> {
  // รวมห้องที่ soft-delete (mergeRooms) · SALES เห็นเฉพาะห้องที่ยังไม่มีผู้ดูแลหรือตัวเองดูแล
  const rooms = await prisma.chatRoom.findMany({ where: { customerId: { in: customerIds }, ...roomAssignmentScope(actor) }, select: { id: true, channel: true, createdAt: true } });
  if (!rooms.length) return [];
  const roomIds = rooms.map((room) => room.id);
  const [days, recontact, todos] = await Promise.all([
    chatDays(prisma, roomIds),
    recontactEvent(prisma, customerIds, roomIds),
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
    // channel ของห้องเป็น enum ChatChannel (ไม่ว่าง) ⇒ firstChatContactTitle ไม่คืน null · ถ้อยคำเดียวกับหน้าสร้างสัญญา (คำตัดสิน 12)
    title: index === 0 ? firstChatContactTitle(chatSourceOf(room.channel))! : `ทักเพิ่มทาง ${JOURNEY_CHAT_CHANNEL_LABELS[room.channel] ?? room.channel}`,
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
    if (row.files > 0 && row.lastFileAt) {
      // คำตัดสินข้อ 12: วันละแถวต่อห้อง ไม่ใช่แถวละไฟล์ · เวลา = ไฟล์เอกสารล่าสุดของวัน · CHAT_DAY ยังนับไฟล์รวมในจำนวนข้อความลูกค้า · หลักฐานขั้น 3 ตรวจเครดิต (ชุดเดียวกับแคช)
      events.push({
        id: `chatfile-${row.roomId}-${row.day}`, type: 'CHAT_CUSTOMER_FILE', group: 'chat', stage: 'CREDIT', timestamp: row.lastFileAt.toISOString(),
        title: `ลูกค้าส่งไฟล์ในแชท${row.files > 1 ? ` ${row.files} ไฟล์` : ''}`, actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE', href: `/inbox/${row.roomId}`,
      });
    }
  }
  for (const todo of todos) {
    if (!todo.dueDate || !todo.roomId) continue;
    const href = `/inbox/${todo.roomId}`;
    events.push({ id: `appointment-${todo.id}`, type: 'APPOINTMENT', group: 'chat', stage: 'INTERESTED', timestamp: todo.createdAt.toISOString(), title: `นัดเข้าร้าน ${formatDateTime(todo.dueDate)}`, actor: staffActor(todo.createdBy), reliability: 'exact', origin: 'SOURCE', href });
    if (todo.completedAt) events.push({ id: `appointment-done-${todo.id}`, type: 'APPOINTMENT_DONE', group: 'chat', stage: 'INTERESTED', timestamp: todo.completedAt.toISOString(), title: 'มาตามนัดแล้ว', actor: { type: 'STAFF' }, reliability: 'exact', origin: 'SOURCE', href });
  }
  if (recontact) events.push(recontact);
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

/**
 * "ร้านตอบครั้งแรก (หลังทัก …)" — อ่านแคช state.firstStaffReplyAt ตอนเปิดดู ไม่เขียนอะไร (หน้ารายการไม่คำนวณแคชใหม่ ⇒ อาจช้าตามรอบคำนวณแคช)
 * อยู่นอก roomEvents: SALES ที่มองไม่เห็นห้องยังได้แถวนี้ — เวลาเดียวกันอยู่ใน summary ที่ทุกบทบาทอ่านได้ และแถวไม่มีลิงก์จึงไม่เปิดเผยห้อง
 * customerIds[0] = ลูกค้าที่ยังมีชีวิต (แบบ JourneySummaryService) — placeholder อาจมีแคชค้างจาก race ของ recompute จน sweep วันอาทิตย์ จึงไม่ค้นด้วย in
 * จุดเริ่มนับ: ทักแชทก่อน (firstChannel ขึ้นต้น CHAT_) = contactedAt (เวลาแถว "ทักแชทครั้งแรก") · มาหน้าร้าน/แนะนำก่อน = ข้อความลูกค้าแรกของทุกห้องในครอบครัว
 * (ไม่จำกัดห้องตามสิทธิ์ · รวมห้อง/ข้อความที่ soft-delete แบบ journey-state.sql) — contactedAt ของคนที่มาร้านก่อนจะนับวันที่ยังไม่ได้ทักรวมไปด้วย
 * ไม่ออกแถวเมื่อยังไม่มีคำตอบ · หาจุดเริ่มไม่ได้ · คำตอบมาก่อนจุดเริ่ม
 */
async function firstStaffReplyEvents(prisma: PrismaService, customerIds: string[]): Promise<JourneyEvent[]> {
  const state = await prisma.customerJourneyState.findUnique({
    where: { customerId: customerIds[0] },
    select: { customerId: true, firstStaffReplyAt: true, contactedAt: true, firstChannel: true },
  });
  const repliedAt = state?.firstStaffReplyAt;
  if (!state || !repliedAt) return [];
  const anchor = state.firstChannel.startsWith(CHAT_SOURCE_PREFIX)
    ? state.contactedAt
    : (await prisma.chatMessage.aggregate({ where: { role: 'CUSTOMER', room: { is: { customerId: { in: customerIds } } } }, _min: { createdAt: true } }))._min.createdAt;
  if (!anchor || repliedAt < anchor) return [];
  return [{
    id: `staffreply-${state.customerId}`, type: 'FIRST_STAFF_REPLY', group: 'chat', stage: null, timestamp: repliedAt.toISOString(),
    title: `ร้านตอบครั้งแรก (หลังทัก ${formatReplyGap(repliedAt.getTime() - anchor.getTime())})`,
    // ระบบข้ามข้อความในนาทีแรกหลังข้อความทักทายอัตโนมัติ ⇒ ตอบเร็วมากอาจแสดงช้ากว่าจริง · ไม่เลื่อนขั้น
    actor: { type: 'STAFF' }, reliability: 'approximate', origin: 'SOURCE',
  }];
}

/** กลุ่ม chat · PDPA: ไม่อ่าน chat_messages.text/media_type · media_url อยู่ในเงื่อนไขไฟล์เอกสารเท่านั้น (ไม่ select) · todo.title/description · เบอร์/ที่อยู่ใน audit */
export const chatSource: JourneySource = async (prisma, customerIds, window, actor) => {
  if (!roleSeesGroup(actor.role, 'chat')) return [];
  const [rooms, leads, created, staffReply] = await Promise.all([
    roomEvents(prisma, customerIds, actor),
    leadEvents(prisma, customerIds, window),
    createdEvents(prisma, customerIds),
    firstStaffReplyEvents(prisma, customerIds),
  ]);
  return finalizeSource([...rooms, ...leads, ...created, ...staffReply], window);
};
