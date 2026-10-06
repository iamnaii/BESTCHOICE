import { ChatChannel, MessageRole, MessageType, PrismaClient } from '@prisma/client';
import type { JourneyEvent } from '@installment/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import { formatDateTime } from '../../../utils/thai-date.util';
import { chatSource } from './chat.source';

/** audit_logs ลบไม่ได้ (trigger migration 20260520300000) ⇒ แถว AI_LEAD_CAPTURED ของสเปคค้างในฐานทดสอบโดยตั้งใจ · ผู้ใช้ upsert ไม่ลบ */
describe('chatSource (real DB)', () => {
  const prisma = new PrismaClient();
  const db = prisma as unknown as PrismaService;
  const stamp = Date.now();
  const ids = {
    staff: '', staffName: '', other: '', customer: '', walkIn: '', open: '', assigned: '',
    filer: '', fileOpen: '', fileAssigned: '', walkInChat: '', walkInPlaceholder: '', walkInRoom: '', walkInPlaceholderRoom: '', noReply: '', noAnchor: '', replyEarly: '',
  };
  const NBSP = ' ';
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

    // เฟส 3 — ไฟล์ที่ลูกค้าส่งในแชท + ร้านตอบครั้งแรก · แคช state ใส่ตรง ๆ (แหล่งอ่านแคช ไม่พึ่งกติกา staff_reply ใน journey-state.sql)
    ids.filer = (await prisma.customer.create({ data: { name: 'journey file spec', acquisitionSource: 'CHAT_FACEBOOK' } })).id;
    ids.walkInChat = (await prisma.customer.create({ data: { name: 'journey walk-in chat spec', createdAt: new Date('2026-09-01T03:00:00.000Z') } })).id;
    ids.walkInPlaceholder = (await prisma.customer.create({ data: { name: 'Facebook #journey-spec', acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date('2026-09-06T00:00:00.000Z'), mergedIntoId: ids.walkInChat } })).id;
    ids.noReply = (await prisma.customer.create({ data: { name: 'journey no reply spec', acquisitionSource: 'CHAT_FACEBOOK' } })).id;
    ids.noAnchor = (await prisma.customer.create({ data: { name: 'journey no anchor spec', createdAt: new Date('2026-09-01T03:00:00.000Z') } })).id;
    ids.replyEarly = (await prisma.customer.create({ data: { name: 'journey reply early spec', acquisitionSource: 'CHAT_FACEBOOK' } })).id;
    const room = async (customerId: string, channel: ChatChannel, iso: string, key: string, assignedToId?: string) =>
      (await prisma.chatRoom.create({ data: { channel, externalUserId: `journey-${key}-${stamp}`, customerId, assignedToId, createdAt: new Date(iso) } })).id;
    ids.fileOpen = await room(ids.filer, ChatChannel.FACEBOOK, '2026-09-10T01:50:00.000Z', 'file-open');
    ids.fileAssigned = await room(ids.filer, ChatChannel.LINE_SHOP, '2026-09-10T03:00:00.000Z', 'file-assigned', ids.other);
    ids.walkInRoom = await room(ids.walkInChat, ChatChannel.FACEBOOK, '2026-09-05T01:00:00.000Z', 'walkin-room', ids.other);
    ids.walkInPlaceholderRoom = await room(ids.walkInPlaceholder, ChatChannel.FACEBOOK, '2026-09-04T22:00:00.000Z', 'walkin-placeholder-room', ids.other);
    // ชื่อไฟล์ ลิงก์ และชนิดไฟล์เป็นค่าเฝ้าระวัง — ต้องไม่หลุดถึงคำตอบ · ค่าเริ่มต้นลงท้าย .pdf = ไฟล์เอกสาร (CUSTOMER_DOCUMENT_FILE_SQL)
    const typed = (roomId: string, role: MessageRole, type: MessageType, iso: string, mediaUrl: string | null = 'https://files.example.test/sentinel-media.pdf') => ({
      roomId, role, type, text: 'statement-sentinel.pdf', mediaUrl, mediaType: 'application/x-sentinel', createdAt: new Date(iso),
    });
    await prisma.chatMessage.createMany({ data: [
      msg(ids.fileOpen, MessageRole.CUSTOMER, 'ขอส่งเอกสารครับ', '2026-09-10T02:00:00.000Z'), // 09:00 ไทยวันที่ 10
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T02:05:00.000Z'),
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T02:06:00.000Z'),
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T02:07:00.000Z'),
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T02:08:00.000Z', null), // ไม่มีลิงก์ไฟล์ ไม่นับ (R-P1)
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T02:09:00.000Z', 'https://www.facebook.com/share/p/sentinel-share/'), // ลิงก์แชร์ที่ webhook เก็บเป็น FILE ไม่นับ
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-12T03:00:00.000Z', 'https://files.example.test/sentinel-photo.jpg'), // วันที่มีแต่ไฟล์ที่ไม่ใช่เอกสาร → ไม่มีแถวไฟล์
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.IMAGE, '2026-09-10T02:10:00.000Z'), // รูปภาพไม่นับ (ใหม่กว่าไฟล์ล่าสุด)
      typed(ids.fileOpen, MessageRole.STAFF, MessageType.FILE, '2026-09-10T02:15:00.000Z'), // ไฟล์ของร้านไม่นับ
      typed(ids.fileOpen, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T18:00:00.000Z'), // 01:00 ไทยวันที่ 11 — UTC ยังเป็นวันที่ 10
      typed(ids.fileAssigned, MessageRole.CUSTOMER, MessageType.FILE, '2026-09-10T03:30:00.000Z'),
      msg(ids.walkInPlaceholderRoom, MessageRole.CUSTOMER, 'สวัสดีครับ', '2026-09-04T22:00:00.000Z'), // ข้อความลูกค้าแรกของครอบครัว อยู่ในห้องของ placeholder
      msg(ids.walkInRoom, MessageRole.CUSTOMER, 'ยังมีเครื่องไหม', '2026-09-05T01:00:00.000Z'),
      msg(ids.walkInRoom, MessageRole.STAFF, 'มีค่ะ', '2026-09-05T04:00:00.000Z'),
    ] });
    const state = (customerId: string, firstChannel: string, contactedAt: string, firstStaffReplyAt: string | null) => ({
      customerId, stage: 'CONTACTED', stageEnteredAt: new Date(contactedAt), path: 'UNKNOWN', contactedAt: new Date(contactedAt), firstChannel, firstSource: firstChannel,
      firstStaffReplyAt: firstStaffReplyAt ? new Date(firstStaffReplyAt) : null, computedAt: new Date('2026-09-14T00:00:00.000Z'),
    });
    await prisma.customerJourneyState.createMany({ data: [
      // ทักแชทก่อน: นับจาก contactedAt (ห้องเกิด 01:50 ก่อนข้อความลูกค้า 02:00) → 25 นาที · ถ้านับจากข้อความลูกค้าแรกจะได้ 15 นาที
      state(ids.filer, 'CHAT_FACEBOOK', '2026-09-10T01:50:00.000Z', '2026-09-10T02:15:00.000Z'),
      // มาหน้าร้านก่อน: นับจากข้อความลูกค้าแรกของทุกห้องในครอบครัว (ห้อง placeholder 4 ก.ย. 22:00 UTC) → 6 ชม. · contactedAt จะได้ 4 วัน · ห้องของลูกค้าเองอย่างเดียวจะได้ 3 ชม.
      state(ids.walkInChat, 'WALK_IN', '2026-09-01T03:00:00.000Z', '2026-09-05T04:00:00.000Z'),
      state(ids.noReply, 'CHAT_FACEBOOK', '2026-09-10T02:00:00.000Z', null),
      state(ids.noAnchor, 'WALK_IN', '2026-09-01T03:00:00.000Z', '2026-09-02T03:00:00.000Z'), // ไม่มีห้อง/ข้อความลูกค้า ⇒ หาจุดเริ่มไม่ได้
      state(ids.replyEarly, 'CHAT_FACEBOOK', '2026-09-10T05:00:00.000Z', '2026-09-10T04:00:00.000Z'), // คำตอบก่อนจุดเริ่ม
    ] });
  });

  afterAll(async () => {
    const roomIds = [ids.open, ids.assigned, ids.fileOpen, ids.fileAssigned, ids.walkInRoom, ids.walkInPlaceholderRoom];
    const phase3 = [ids.filer, ids.walkInChat, ids.noReply, ids.noAnchor, ids.replyEarly];
    await prisma.todo.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: phase3 } } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.walkInPlaceholder] } } }); // placeholder ก่อนเป้าหมาย (merged_into_id)
    await prisma.customer.deleteMany({ where: { id: { in: [ids.customer, ids.walkIn, ...phase3] } } });
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

  it('เฟส 3: ไฟล์เอกสารที่ลูกค้าส่ง = แถวละห้องต่อวันไทย · เวลา = ไฟล์เอกสารล่าสุดของวัน · ไม่นับรูปภาพ/ไฟล์ของร้าน/ไม่มีลิงก์/ลิงก์แชร์ · แถวคุยแชทนับเท่าเดิม · ไม่หลุดชื่อไฟล์/ลิงก์', async () => {
    const events = await chatSource(db, [ids.filer], { limit: 50 }, OWNER);
    const fileRow = { type: 'CHAT_CUSTOMER_FILE', group: 'chat', stage: 'CREDIT', actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE' };
    expect(byId(events, `chatfile-${ids.fileOpen}-2026-09-10`)).toEqual({
      ...fileRow, id: `chatfile-${ids.fileOpen}-2026-09-10`, timestamp: '2026-09-10T02:07:00.000Z', title: 'ลูกค้าส่งไฟล์ในแชท 3 ไฟล์', href: `/inbox/${ids.fileOpen}`,
    });
    expect(byId(events, `chatfile-${ids.fileOpen}-2026-09-11`)).toEqual({
      ...fileRow, id: `chatfile-${ids.fileOpen}-2026-09-11`, timestamp: '2026-09-10T18:00:00.000Z', title: 'ลูกค้าส่งไฟล์ในแชท', href: `/inbox/${ids.fileOpen}`,
    });
    expect(byId(events, `chatfile-${ids.fileAssigned}-2026-09-10`)).toMatchObject({ timestamp: '2026-09-10T03:30:00.000Z', title: 'ลูกค้าส่งไฟล์ในแชท', href: `/inbox/${ids.fileAssigned}` });
    expect(events.filter((e) => e.type === 'CHAT_CUSTOMER_FILE')).toHaveLength(3);
    expect(byId(events, `chatfile-${ids.fileOpen}-2026-09-12`)).toBeUndefined();
    expect(byId(events, `chatday-${ids.fileOpen}-2026-09-12`)).toBeDefined();
    // CHAT_DAY นับข้อความลูกค้าทุกชนิด (รวมไฟล์ที่ไม่ใช่เอกสาร 2 ข้อความ) — เงื่อนไขไฟล์เอกสารใช้กับแถวไฟล์เท่านั้น
    expect(byId(events, `chatday-${ids.fileOpen}-2026-09-10`)).toMatchObject({ timestamp: '2026-09-10T02:15:00.000Z', title: 'คุยแชท: ลูกค้า 7 ข้อความ · ร้านตอบ 1' });
    const json = JSON.stringify(events);
    for (const secret of ['sentinel', 'ขอส่งเอกสาร', 'facebook.com']) expect(json).not.toContain(secret);
  });

  it('เฟส 3: SALES ไม่เห็นแถวไฟล์ของห้องที่คนอื่นดูแล · ACCOUNTANT ไม่ได้ทั้งแถวไฟล์และร้านตอบครั้งแรก', async () => {
    const sales = await chatSource(db, [ids.filer], { limit: 50 }, { id: ids.staff, role: 'SALES' });
    expect(sales.some((e) => e.id === `chatfile-${ids.fileAssigned}-2026-09-10`)).toBe(false);
    expect(sales.some((e) => e.id === `chatfile-${ids.fileOpen}-2026-09-10`)).toBe(true);
    const accountant = { id: 'a1', role: 'ACCOUNTANT' };
    expect(await chatSource(db, [ids.filer], { limit: 50 }, accountant)).toEqual([]);
    expect(await chatSource(db, [ids.walkInChat, ids.walkInPlaceholder], { limit: 50 }, accountant)).toEqual([]);
  });

  it('เฟส 3: ร้านตอบครั้งแรก — ทักแชทก่อนนับจาก contactedAt · มาหน้าร้านก่อนนับจากข้อความลูกค้าแรกของทุกห้องในครอบครัว · ไม่ผูกสิทธิ์ห้อง · ไม่มีลิงก์', async () => {
    const replyRow = { type: 'FIRST_STAFF_REPLY', group: 'chat', stage: null, actor: { type: 'STAFF' }, reliability: 'approximate', origin: 'SOURCE' };
    expect(byId(await chatSource(db, [ids.filer], { limit: 50 }, OWNER), `staffreply-${ids.filer}`)).toEqual({
      ...replyRow, id: `staffreply-${ids.filer}`, timestamp: '2026-09-10T02:15:00.000Z', title: `ร้านตอบครั้งแรก (หลังทัก 25${NBSP}นาที)`,
    });
    const walkIn = { ...replyRow, id: `staffreply-${ids.walkInChat}`, timestamp: '2026-09-05T04:00:00.000Z', title: `ร้านตอบครั้งแรก (หลังทัก 6${NBSP}ชม.)` };
    expect(byId(await chatSource(db, [ids.walkInChat, ids.walkInPlaceholder], { limit: 50 }, OWNER), walkIn.id)).toEqual(walkIn);
    // ทั้งสองห้องมีคนอื่นดูแล ⇒ SALES ไม่เห็นห้องเลย แต่ยังได้แถวร้านตอบครั้งแรก (เวลาเดียวกันอยู่ใน summary ที่ทุกบทบาทอ่านได้)
    const sales = await chatSource(db, [ids.walkInChat, ids.walkInPlaceholder], { limit: 50 }, { id: ids.staff, role: 'SALES' });
    expect(sales.map((e) => e.type).sort()).toEqual(['CUSTOMER_CREATED_BY_STAFF', 'FIRST_STAFF_REPLY']);
    expect(byId(sales, walkIn.id)).toEqual(walkIn);
  });

  it('เฟส 3: ไม่ออกแถวร้านตอบครั้งแรกเมื่อยังไม่มีคำตอบ · หาจุดเริ่มไม่ได้ · คำตอบมาก่อนจุดเริ่ม', async () => {
    expect(await chatSource(db, [ids.noReply], { limit: 50 }, OWNER)).toEqual([]);
    expect((await chatSource(db, [ids.noAnchor], { limit: 50 }, OWNER)).map((e) => e.type)).toEqual(['CUSTOMER_CREATED_BY_STAFF']);
    expect(await chatSource(db, [ids.replyEarly], { limit: 50 }, OWNER)).toEqual([]);
  });
});
