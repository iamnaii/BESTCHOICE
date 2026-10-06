import { ChatChannel, MessageRole, PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { JourneyStateService } from '../journey-state.service';
import { chatSource } from './chat.source';
import { saleSource } from './sale.source';

/**
 * แถว "กลับมาติดต่ออีกครั้ง" (RECONTACTED) กับ Postgres จริง — คำตัดสินเจ้าของ 2026-09-15 ข้อ 6 + 12
 * ต้องสอดคล้องกับการล้างป้ายหลุดของ journey-state.sql: ข้อความลูกค้าหลัง mark = ออกแถว + ป้ายล้าง ·
 * เอกสาร 6 ชนิดเวลาอยู่ใน (mark, ข้อความ] = ป้ายล้างแต่ไม่ออกแถว (แถวเอกสารอธิบายแทน) · ข้อมูลทั้งหมดเป็นของสังเคราะห์
 * ผู้ใช้/สาขาของ spec ถูกปล่อยไว้ (audit_logs ลบไม่ได้) ตามแบบ journey-state.service.db.spec.ts
 * ใบจองทุกใบในไฟล์นี้ status EXPIRED (ห้ามถอด): product_reservations มี partial unique index product_reservations_active_product_idx
 *   (product_id WHERE status = 'ACTIVE' — migration 20260986000000) และ DOCUMENTS.productReservation กับใบจองของ DOCUMENTS.onlineOrder
 *   ใช้ productId เดียวกันใน it.each เดียว ⇒ ACTIVE ใบที่สองชน P2002 · sale source / doc_last_at นับใบจองทุกสถานะ จึงไม่เปลี่ยนผลของเทส
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('chatSource RECONTACTED (real DB)', () => {
  const prisma = new PrismaClient();
  const db = prisma as unknown as PrismaService;
  const state = new JourneyStateService(db);
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (iso: string) => new Date(iso);
  const OWNER = { id: 'owner-spec', role: 'OWNER' };
  const SECRET = 'ข้อความลับสเปคกลับมาติดต่อ';
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  let seq = 0;
  let branchId = '';
  let productId = '';
  let staffId = '';
  let otherId = '';

  const recontacts = async (customerId: string, actor: { id: string; role: string } = OWNER) =>
    (await chatSource(db, [customerId], { limit: 50 }, actor)).filter((e) => e.type === 'RECONTACTED');
  const lostAtOf = async (customerId: string) => {
    await state.recompute([customerId]);
    return (await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId } })).lostAt?.toISOString() ?? null;
  };

  async function customer(label: string) {
    const row = await prisma.customer.create({ data: { name: `journey recontact ${label}`, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at('2026-09-01T00:00:00.000Z') } });
    customerIds.push(row.id);
    return row.id;
  }
  async function room(customerId: string, assignedToId: string | null = null) {
    const row = await prisma.chatRoom.create({ data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-recontact-${stamp}-${++seq}`, customerId, assignedToId, createdAt: at('2026-09-01T00:00:00.000Z') } });
    roomIds.push(row.id);
    return row.id;
  }
  const say = (roomId: string, iso: string, role: MessageRole = MessageRole.CUSTOMER) =>
    prisma.chatMessage.create({ data: { roomId, role, text: SECRET, createdAt: at(iso) } });
  const mark = (customerId: string, kind: 'MARKED_LOST' | 'REOPENED', iso: string, deletedAt: Date | null = null) =>
    prisma.customerJourneyEntry.create({
      data: { customerId, originCustomerId: customerId, origin: 'MANUAL', kind, occurredAt: at(iso), actorType: 'STAFF', lostReason: kind === 'MARKED_LOST' ? 'NOT_INTERESTED' : null, deletedAt },
    });

  /** ชุดเดียวกับ doc_last_at ของ journey-state.sql (Task 3) — คำสั่งซื้อผูกการจองที่ไม่มีลูกค้า เพื่อพิสูจน์ว่าคำสั่งซื้อกันแถวได้ด้วยตัวเอง */
  const DOCUMENTS = {
    booking: (customerId: string, iso: string) =>
      prisma.booking.create({ data: { bookingNumber: `JRB-${tail}-${++seq}`, customerId, branchId, depositAmount: 1000, totalAmount: 25000, expireDate: at('2026-09-30T00:00:00.000Z'), createdById: staffId, createdAt: at(iso) } }),
    onlineInstallmentApplication: (customerId: string, iso: string) =>
      prisma.onlineInstallmentApplication.create({ data: { applicationNumber: `JRA-${tail}-${++seq}`, customerId, productId, fullName: 'journey recontact spec', phone: '0000000000', nationalId: '0000000000000', proposedDownPayment: 5000, proposedTotalMonths: 10, proposedMonthlyPayment: 2400, createdAt: at(iso) } }),
    productReservation: (customerId: string, iso: string) =>
      prisma.productReservation.create({ data: { productId, customerId, sessionId: `journey-recontact-${stamp}-${++seq}`, status: 'EXPIRED', reservedAt: at(iso), expiresAt: at('2026-09-30T00:00:00.000Z') } }),
    tradeIn: (customerId: string, iso: string) =>
      prisma.tradeIn.create({ data: { customerId, deviceBrand: 'Apple', deviceModel: 'iPhone 12', createdAt: at(iso) } }),
    savingPlan: (customerId: string, iso: string) =>
      prisma.savingPlan.create({ data: { planNumber: `JRS-${tail}-${++seq}`, customerId, targetAmount: 20000, monthlyAmount: 2000, durationMonths: 10, startedAt: at(iso), createdAt: at(iso) } }),
    onlineOrder: async (customerId: string, iso: string) => {
      const hold = await prisma.productReservation.create({ data: { productId, customerId: null, sessionId: `journey-recontact-${stamp}-${++seq}`, status: 'EXPIRED', reservedAt: at('2026-08-01T00:00:00.000Z'), expiresAt: at('2026-09-30T00:00:00.000Z') } });
      return prisma.onlineOrder.create({ data: { orderNumber: `JRO-${tail}-${++seq}`, customerId, productId, reservationId: hold.id, productPrice: 25000, totalAmount: 25000, shippingMethod: 'BRANCH_PICKUP', paymentChannel: 'PROMPTPAY_QR', createdAt: at(iso) } });
    },
  };
  const DOCUMENT_KINDS = Object.keys(DOCUMENTS) as Array<keyof typeof DOCUMENTS>;
  /** แถวกลุ่มขายที่อธิบายการล้างป้ายแทนแถว "กลับมาติดต่ออีกครั้ง" (canvas TimelineRows g4) — หนึ่งชนิดต่อเอกสาร */
  const DOCUMENT_ROW_TYPE: Record<keyof typeof DOCUMENTS, string> = {
    booking: 'BOOKING_OPENED',
    onlineInstallmentApplication: 'ONLINE_APPLICATION',
    productReservation: 'WEB_HOLD',
    tradeIn: 'TRADE_IN',
    savingPlan: 'SAVING_PLAN_OPENED',
    onlineOrder: 'ONLINE_ORDER_PLACED',
  };

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `journey recontact ${stamp}` } })).id;
    staffId = (await prisma.user.create({ data: { email: `journey-recontact-staff-${stamp}@spec.local`, password: 'x', name: 'journey recontact staff' } })).id;
    otherId = (await prisma.user.create({ data: { email: `journey-recontact-other-${stamp}@spec.local`, password: 'x', name: 'journey recontact other' } })).id;
    productId = (await prisma.product.create({ data: { name: 'journey recontact phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId } })).id;
  });

  afterAll(async () => {
    await prisma.onlineOrder.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.productReservation.deleteMany({ where: { productId } });
    await prisma.onlineInstallmentApplication.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.savingPlan.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.tradeIn.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.booking.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('ติดป้ายหลุดแล้วลูกค้าทักกลับ → หนึ่งแถวที่ข้อความลูกค้าแรกหลัง mark (ข้ามห้อง · ไม่นับข้อความร้าน) · ป้ายหลุดล้าง · ไม่มีข้อความแชทในผล', async () => {
    const c = await customer('comeback');
    const first = await room(c);
    const second = await room(c);
    await say(first, '2026-09-02T00:00:00.000Z');
    const lost = await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await say(first, '2026-09-04T00:00:00.000Z', MessageRole.STAFF);
    await say(first, '2026-09-06T00:00:00.000Z');
    await say(second, '2026-09-05T01:00:00.000Z');
    expect(await recontacts(c)).toEqual([
      { id: `recontact-${lost.id}`, type: 'RECONTACTED', group: 'chat', stage: null, timestamp: '2026-09-05T01:00:00.000Z', title: 'กลับมาติดต่ออีกครั้ง', actor: { type: 'CUSTOMER' }, reliability: 'exact', origin: 'SOURCE', href: `/inbox/${second}` },
    ]);
    expect(JSON.stringify(await chatSource(db, [c], { limit: 50 }, OWNER))).not.toContain(SECRET);
    expect(await lostAtOf(c)).toBeNull();
  });

  it('ข้อความเวลาเท่ากับ mark → ไม่มีแถว และยังหลุดอยู่ (ต้องหลัง mark จริง)', async () => {
    const c = await customer('same-time');
    const r = await room(c);
    await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await say(r, '2026-09-03T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([]);
    expect(await lostAtOf(c)).toBe('2026-09-03T00:00:00.000Z');
  });

  it('เปิดใหม่หลัง mark → ไม่มีแถว', async () => {
    const c = await customer('reopened');
    const r = await room(c);
    await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await mark(c, 'REOPENED', '2026-09-04T00:00:00.000Z');
    await say(r, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([]);
    expect(await lostAtOf(c)).toBeNull();
  });

  it('mark ล่าสุดถูกเลิกทำ (deletedAt) → mark ก่อนหน้าเป็นตัวตัดสิน', async () => {
    const c = await customer('undone');
    const r = await room(c);
    const kept = await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await mark(c, 'MARKED_LOST', '2026-09-05T00:00:00.000Z', at('2026-09-05T00:10:00.000Z'));
    await say(r, '2026-09-04T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([expect.objectContaining({ id: `recontact-${kept.id}`, timestamp: '2026-09-04T00:00:00.000Z', href: `/inbox/${r}` })]);
    expect(await lostAtOf(c)).toBeNull();
  });

  it.each(DOCUMENT_KINDS)('เอกสาร %s หลัง mark ล้างป้ายเอง · ลูกค้าทักทีหลังก็ไม่ออกแถว · แถวเอกสารกลุ่มขายอธิบายแทน ณ เวลาเอกสาร', async (kind) => {
    const c = await customer(`doc-${kind}`);
    const r = await room(c);
    await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await DOCUMENTS[kind](c, '2026-09-04T00:00:00.000Z');
    expect(await lostAtOf(c)).toBeNull();
    await say(r, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([]);
    // ป้ายหายโดยไม่มีแถว "กลับมาติดต่ออีกครั้ง" ⇒ ต้องมีแถวของเอกสารนั้นที่เวลาเดียวกับ doc_last_at เสมอ (ไม่มีเอกสารชนิดไหนล้างป้ายแบบเงียบ)
    const explaining = (await saleSource(db, [c], { limit: 50 }, OWNER)).filter((e) => e.timestamp === '2026-09-04T00:00:00.000Z');
    expect(explaining.map((e) => [e.type, e.group, e.stage])).toEqual([[DOCUMENT_ROW_TYPE[kind], 'sale', 'INTERESTED']]);
  });

  it('ขอบช่วง (mark, ข้อความ]: เอกสารเวลาเท่ากับ mark ไม่กันแถว · เอกสารเวลาเท่ากับข้อความกันแถว', async () => {
    const atMark = await customer('doc-at-mark');
    const r1 = await room(atMark);
    await mark(atMark, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await DOCUMENTS.booking(atMark, '2026-09-03T00:00:00.000Z');
    await say(r1, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(atMark)).toHaveLength(1);

    const atMessage = await customer('doc-at-message');
    const r2 = await room(atMessage);
    await mark(atMessage, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await DOCUMENTS.booking(atMessage, '2026-09-05T00:00:00.000Z');
    await say(r2, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(atMessage)).toEqual([]);
  });

  it('ลูกค้าทักก่อนแล้วค่อยมีเอกสาร → ออกแถวที่ข้อความ (ข้อความล้างป้ายก่อน)', async () => {
    const c = await customer('message-first');
    const r = await room(c);
    const lost = await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await say(r, '2026-09-04T00:00:00.000Z');
    await DOCUMENTS.savingPlan(c, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([expect.objectContaining({ id: `recontact-${lost.id}`, timestamp: '2026-09-04T00:00:00.000Z' })]);
    expect(await lostAtOf(c)).toBeNull();
  });

  it('TOUCHPOINT ระหว่าง mark กับข้อความไม่กันแถว', async () => {
    const c = await customer('touchpoint');
    const r = await room(c);
    const lost = await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await prisma.customerJourneyEntry.create({ data: { customerId: c, originCustomerId: c, origin: 'MANUAL', kind: 'TOUCHPOINT', occurredAt: at('2026-09-04T00:00:00.000Z'), actorType: 'STAFF', channel: 'PHONE', outcome: 'THINKING' } });
    await say(r, '2026-09-05T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([expect.objectContaining({ id: `recontact-${lost.id}`, timestamp: '2026-09-05T00:00:00.000Z' })]);
  });

  it('มีแค่รอบหลุดล่าสุด: ติดป้ายซ้ำหลังลูกค้าทักกลับ → แถวรอบก่อนหาย จนลูกค้าทักหลัง mark ใหม่', async () => {
    const c = await customer('episodes');
    const r = await room(c);
    await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await say(r, '2026-09-04T00:00:00.000Z');
    const second = await mark(c, 'MARKED_LOST', '2026-09-05T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([]);
    expect(await lostAtOf(c)).toBe('2026-09-05T00:00:00.000Z');
    await say(r, '2026-09-06T00:00:00.000Z');
    expect(await recontacts(c)).toEqual([expect.objectContaining({ id: `recontact-${second.id}`, timestamp: '2026-09-06T00:00:00.000Z' })]);
  });

  it('SALES: ข้อความหลัง mark อยู่แค่ในห้องที่คนอื่นดูแล → ไม่มีแถว (ผู้ดูแลห้องและ OWNER เห็น) · ACCOUNTANT ไม่มีแถว · ป้ายยังล้าง', async () => {
    const c = await customer('scoped');
    const mine = await room(c);
    const others = await room(c, otherId);
    await say(mine, '2026-09-02T00:00:00.000Z');
    await mark(c, 'MARKED_LOST', '2026-09-03T00:00:00.000Z');
    await say(others, '2026-09-04T00:00:00.000Z');
    expect(await recontacts(c, { id: staffId, role: 'SALES' })).toEqual([]);
    expect(await recontacts(c, { id: otherId, role: 'SALES' })).toEqual([expect.objectContaining({ href: `/inbox/${others}` })]);
    expect(await recontacts(c)).toEqual([expect.objectContaining({ href: `/inbox/${others}` })]);
    expect(await recontacts(c, { id: 'accountant-spec', role: 'ACCOUNTANT' })).toEqual([]);
    expect(await lostAtOf(c)).toBeNull();
  });
});
