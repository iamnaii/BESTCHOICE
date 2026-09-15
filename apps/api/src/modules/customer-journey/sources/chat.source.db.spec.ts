import { ChatChannel, MessageRole, PrismaClient } from '@prisma/client';
import type { JourneyEvent } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { formatDateTime } from '../../../utils/thai-date.util';
import { chatSource } from './chat.source';

/** audit_logs ลบไม่ได้ (trigger migration 20260520300000) ⇒ แถว AI_LEAD_CAPTURED ของสเปคค้างในฐานทดสอบโดยตั้งใจ · ผู้ใช้ upsert ไม่ลบ */
describe('chatSource (real DB)', () => {
  const prisma = new PrismaClient();
  const db = prisma as unknown as PrismaService;
  const stamp = Date.now();
  const ids = { staff: '', staffName: '', other: '', customer: '', walkIn: '', open: '', assigned: '' };
  const OWNER = { id: 'owner-spec', role: 'OWNER' };
  const byId = (events: JourneyEvent[], id: string) => events.find((e) => e.id === id);
  const upsertUser = (email: string, name: string) =>
    prisma.user.upsert({ where: { email }, update: {}, create: { email, password: 'journey-spec', name, role: 'SALES' } });

  beforeAll(async () => {
    const staff = await upsertUser('journey-spec-staff@example.test', 'พนักงานสเปคการเดินทาง');
    Object.assign(ids, { staff: staff.id, staffName: staff.name, other: (await upsertUser('journey-spec-other@example.test', 'พนักงานอีกคน')).id });
    ids.customer = (await prisma.customer.create({ data: { name: 'journey chat spec', acquisitionSource: 'CHAT_FACEBOOK' } })).id;
    ids.walkIn = (await prisma.customer.create({ data: { name: 'journey walk-in spec', phone: `08${String(stamp).slice(-8)}`, createdAt: new Date('2026-09-01T03:00:00.000Z') } })).id;
    ids.open = (await prisma.chatRoom.create({ data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-open-${stamp}`, customerId: ids.customer, createdAt: new Date('2026-09-10T03:00:00.000Z') } })).id;
    ids.assigned = (await prisma.chatRoom.create({ data: { channel: ChatChannel.LINE_SHOP, externalUserId: `journey-assigned-${stamp}`, customerId: ids.customer, assignedToId: ids.other, createdAt: new Date('2026-09-12T03:00:00.000Z') } })).id;
    const msg = (roomId: string, role: MessageRole, text: string, iso: string, deletedAt?: Date) => ({ roomId, role, text, createdAt: new Date(iso), deletedAt });
    await prisma.chatMessage.createMany({ data: [
      msg(ids.open, MessageRole.CUSTOMER, 'สนใจครับ เบอร์ 0899999999', '2026-09-08T16:30:00.000Z'), // 23:30 ไทยวันที่ 8
      msg(ids.open, MessageRole.CUSTOMER, 'ผ่อนได้ไหม', '2026-09-08T17:30:00.000Z'), // 00:30 ไทยวันที่ 9
      msg(ids.open, MessageRole.STAFF, 'ได้ค่ะ', '2026-09-08T17:40:00.000Z'),
      msg(ids.open, MessageRole.BOT, 'ส่งตารางผ่อน', '2026-09-08T17:41:00.000Z'),
      msg(ids.open, MessageRole.CUSTOMER, 'บ้านเลขที่ 99/1', '2026-09-08T17:50:00.000Z', new Date('2026-09-14T00:00:00.000Z')),
      msg(ids.open, MessageRole.SYSTEM, 'ระบบ', '2026-09-08T17:55:00.000Z'),
      msg(ids.assigned, MessageRole.CUSTOMER, 'ห้องของคนอื่น', '2026-09-12T04:00:00.000Z'),
    ] });
    await prisma.todo.create({ data: { title: 'นัดลูกค้า 0899999999', createdById: ids.staff, roomId: ids.open, dueDate: new Date('2026-09-20T07:00:00.000Z'), createdAt: new Date('2026-09-09T02:00:00.000Z'), completedAt: new Date('2026-09-20T07:30:00.000Z') } });
    await prisma.auditLog.create({ data: { userId: ids.staff, action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: ids.customer, createdAt: new Date('2026-09-09T05:00:00.000Z'),
      newValue: { customerName: 'สมชาย ใจดี', phone: '0899999999', address: 'บ้านเลขที่ 99/1', productId: 'p-1', packageChoice: 'B', downAmount: 3000, visitPlan: 'เสาร์นี้' } } });
  });

  afterAll(async () => {
    const roomIds = [ids.open, ids.assigned];
    await prisma.todo.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.customer, ids.walkIn] } } });
    await prisma.$disconnect();
  });

  it('ห้องนำเข้านับจากข้อความแรกของลูกค้า (approximate) · แชทรายวันแบ่งวันไทย นับแถว soft-delete ไม่นับ SYSTEM · นัด · บอทจดความสนใจ', async () => {
    const events = await chatSource(db, [ids.customer], { limit: 50 }, OWNER);
    expect(byId(events, `chatroom-${ids.open}`)).toMatchObject({ stage: 'CONTACTED', timestamp: '2026-09-08T16:30:00.000Z', title: 'ทักแชทครั้งแรกทาง Facebook', reliability: 'approximate', href: `/inbox/${ids.open}` });
    expect(byId(events, `chatroom-${ids.assigned}`)).toMatchObject({ stage: null, title: 'ทักเพิ่มทาง LINE ร้าน', reliability: 'exact' });
    expect(byId(events, `chatday-${ids.open}-2026-09-09`)).toMatchObject({ timestamp: '2026-09-08T17:50:00.000Z', title: 'คุยแชท: ลูกค้า 2 ข้อความ · ร้านตอบ 1 · บอท 1', reliability: 'approximate' });
    expect(byId(events, `chatday-${ids.open}-2026-09-08`)).toMatchObject({ title: 'คุยแชท: ลูกค้า 1 ข้อความ', reliability: 'exact' });
    expect(events.find((e) => e.type === 'APPOINTMENT')).toMatchObject({ stage: 'INTERESTED', title: `นัดเข้าร้าน ${formatDateTime(new Date('2026-09-20T07:00:00.000Z'))}`, actor: { type: 'STAFF', id: ids.staff, name: ids.staffName } });
    expect(events.find((e) => e.type === 'APPOINTMENT_DONE')).toMatchObject({ timestamp: '2026-09-20T07:30:00.000Z', title: 'มาตามนัดแล้ว' });
    expect(events.find((e) => e.type === 'AI_LEAD_CAPTURED')).toMatchObject({ title: 'บอทจดความสนใจ · แพ็ก B · ดาวน์ 3,000 บาท', metadata: { packageChoice: 'B', downAmount: 3000, productId: 'p-1' } });
    const json = JSON.stringify(events);
    for (const secret of ['0899999999', 'บ้านเลขที่', 'ผ่อนได้ไหม', 'นัดลูกค้า', 'สมชาย', 'เสาร์นี้']) expect(json).not.toContain(secret);
  });

  it('SALES ไม่เห็นห้องที่คนอื่นดูแล · ผู้ดูแลเห็น · ACCOUNTANT ได้ [] · ลูกค้าหน้าร้าน = พนักงานเพิ่ม', async () => {
    const sales = await chatSource(db, [ids.customer], { limit: 50 }, { id: ids.staff, role: 'SALES' });
    expect(sales.some((e) => e.href === `/inbox/${ids.assigned}`)).toBe(false);
    expect(sales.some((e) => e.href === `/inbox/${ids.open}`)).toBe(true);
    expect((await chatSource(db, [ids.customer], { limit: 50 }, { id: ids.other, role: 'SALES' })).some((e) => e.href === `/inbox/${ids.assigned}`)).toBe(true);
    expect(await chatSource(db, [ids.customer], { limit: 50 }, { id: 'a1', role: 'ACCOUNTANT' })).toEqual([]);
    expect(await chatSource(db, [ids.walkIn], { limit: 50 }, OWNER)).toEqual([
      expect.objectContaining({ id: `customer-${ids.walkIn}`, type: 'CUSTOMER_CREATED_BY_STAFF', stage: 'IDENTIFIED', timestamp: '2026-09-01T03:00:00.000Z', reliability: 'approximate' }),
    ]);
  });

  it('cursor ตัดตัวที่ใหม่กว่าและคืนไม่เกิน limit+1', async () => {
    const all = await chatSource(db, [ids.customer], { limit: 50 }, OWNER);
    const page = await chatSource(db, [ids.customer], { limit: 1, before: { ts: all[1].timestamp, id: all[1].id } }, OWNER);
    expect(page.map((e) => e.id)).toEqual(all.slice(2, 4).map((e) => e.id));
  });
});
