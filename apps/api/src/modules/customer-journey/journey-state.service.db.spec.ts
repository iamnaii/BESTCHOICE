import { Prisma, PrismaClient } from '@prisma/client';
import { JourneyStateService } from './journey-state.service';
import { journeyDedupeKey } from './journey-data-schemas';
import { BOUGHT_WHERE } from '../customers/services/customer-query.service';

/**
 * journey-state.sql กับ Postgres จริง (Plan 2 Task 3) — session timezone ของฐานทดสอบ = Asia/Bangkok จึงจับบั๊ก now()/timestamptz ได้
 * AuditLog ลบไม่ได้ (trigger audit_logs_no_delete) ⇒ ผู้ใช้ของ spec ถูกปล่อยไว้ ตามแบบ customer-merge.service.db.spec.ts
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('JourneyStateService (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new JourneyStateService(prisma as any);
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (value: string) => new Date(value);
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const saleIds: string[] = [];
  const contractIds: string[] = [];
  const todoIds: string[] = [];
  let branchId: string;
  let productId: string;
  let userId: string;

  const stateOf = (customerId: string) => prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId } });
  const boughtLive = async (customerId: string) => (await prisma.customer.count({ where: { AND: [{ id: customerId }, BOUGHT_WHERE] } })) > 0;

  async function customer(data: Prisma.CustomerUncheckedCreateInput) {
    const row = await prisma.customer.create({ data });
    customerIds.push(row.id);
    return row;
  }
  async function room(customerId: string, label: string, createdAt: string, channel: 'FACEBOOK' | 'LINE_SHOP' = 'FACEBOOK') {
    const row = await prisma.chatRoom.create({ data: { channel, externalUserId: `journey-${label}-${stamp}`, customerId, createdAt: at(createdAt) } });
    roomIds.push(row.id);
    return row;
  }
  async function entry(customerId: string, kind: string, occurredAt: string, extra: Partial<Prisma.CustomerJourneyEntryUncheckedCreateInput> = {}) {
    await prisma.customerJourneyEntry.create({
      data: { customerId, originCustomerId: customerId, origin: 'MANUAL', kind, occurredAt: at(occurredAt), actorType: 'STAFF', ...extra },
    });
  }
  async function sale(customerId: string, saleType: 'CASH' | 'INSTALLMENT', createdAt: string, contractId: string | null = null) {
    const row = await prisma.sale.create({
      data: { saleNumber: `JS-${tail}-${saleIds.length}`, saleType, customerId, productId, branchId, salespersonId: userId, sellingPrice: 25000, netAmount: 25000, contractId, createdAt: at(createdAt) },
    });
    saleIds.push(row.id);
    return row;
  }
  async function contract(customerId: string, status: 'ACTIVE' | 'OVERDUE', createdAt: string) {
    const row = await prisma.contract.create({
      data: {
        contractNumber: `JC-${tail}-${contractIds.length}`, customerId, productId, branchId, salespersonId: userId, planType: 'STORE_WITH_INTEREST',
        sellingPrice: 25000, downPayment: 5000, interestRate: 0.02, totalMonths: 10, interestTotal: 4000, financedAmount: 20000, monthlyPayment: 2400,
        status, createdAt: at(createdAt),
      },
    });
    contractIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `journey spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-state-${stamp}@spec.local`, password: 'x', name: 'journey spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'journey spec phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId } })).id;
  });

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.todo.deleteMany({ where: { id: { in: todoIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('ลูกค้าหน้าร้านมีเบอร์ → IDENTIFIED · ทักเข้ามา = created_at · WALK_IN · computedAt ไม่เลื่อน 7 ชม.', async () => {
    const c = await customer({ name: 'journey walkin', phone: `081${tail}`, createdAt: at('2026-09-01T03:00:00.000Z') });
    const before = Date.now();
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect(s).toMatchObject({ stage: 'IDENTIFIED', path: 'UNKNOWN', firstChannel: 'WALK_IN', firstSource: 'WALK_IN', lostAt: null, firstPurchaseAt: null });
    expect(s.contactedAt.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(s.identifiedAt?.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(s.stageEnteredAt.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(Math.abs(s.computedAt.getTime() - before)).toBeLessThan(60_000);
  });

  it('ผู้สนใจจากแชท: ทักเข้ามา = ข้อความลูกค้าแรก (รวมแถว soft-delete) ก่อนเวลาสร้างห้อง · ข้ามข้อความทักทายภายใน 60 วิ', async () => {
    const c = await customer({ name: 'journey chat', phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at('2026-09-10T00:00:00.000Z') });
    const r = await room(c.id, 'chat', '2026-09-10T00:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-05T02:00:00.000Z'), deletedAt: at('2026-09-12T00:00:00.000Z') },
        { roomId: r.id, role: 'STAFF', externalMessageId: `journey-mid-chat-greeting-${stamp}`, createdAt: at('2026-09-05T02:00:30.000Z') },
        { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-05T02:05:00.000Z') },
        { roomId: r.id, role: 'STAFF', createdAt: at('2026-09-05T03:10:00.000Z'), outboundSentAt: at('2026-09-05T03:10:00.000Z') },
        { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-11T09:00:00.000Z') },
      ],
    });
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect(s).toMatchObject({ stage: 'CONTACTED', firstChannel: 'CHAT_FACEBOOK', firstSource: 'CHAT_FACEBOOK', identifiedAt: null });
    expect(s.contactedAt.toISOString()).toBe('2026-09-05T02:00:00.000Z');
    expect(s.stageEnteredAt.toISOString()).toBe('2026-09-05T02:00:00.000Z');
    expect(s.firstStaffReplyAt?.toISOString()).toBe('2026-09-05T03:10:00.000Z');
    expect(s.lastCustomerAt?.toISOString()).toBe('2026-09-11T09:00:00.000Z');
  });

  it('ร้านตอบครั้งแรก: echo จากเพจ (มี external_message_id ไม่มี outbound_sent_at) นับ · ส่งจาก inbox ที่ล้ม (ไม่มีทั้งคู่) ไม่นับ · greeting echo ภายใน 60 วิยังถูกข้าม', async () => {
    const mid = (label: string) => `journey-mid-${label}-${stamp}`;

    // (ก)+(ข) ส่งจาก inbox ล้มก่อน แล้วพนักงานตอบจาก Page Inbox — แคชที่เคยว่างต้องถูกเติมตอนคำนวณใหม่ (LEAST กับ NULL)
    const echo = await customer({ name: 'journey echo', phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at('2026-09-06T00:00:00.000Z') });
    const echoRoom = await room(echo.id, 'echo', '2026-09-06T00:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: echoRoom.id, role: 'CUSTOMER', createdAt: at('2026-09-06T01:00:00.000Z') },
        { roomId: echoRoom.id, role: 'STAFF', createdAt: at('2026-09-06T01:30:00.000Z') },
      ],
    });
    await service.recompute([echo.id]);
    expect((await stateOf(echo.id)).firstStaffReplyAt).toBeNull();
    await prisma.chatMessage.create({ data: { roomId: echoRoom.id, role: 'STAFF', externalMessageId: mid('echo'), createdAt: at('2026-09-06T02:15:00.000Z') } });
    await service.recompute([echo.id]);
    expect((await stateOf(echo.id)).firstStaffReplyAt?.toISOString()).toBe('2026-09-06T02:15:00.000Z');

    // (ข) มีแต่การส่งที่ล้ม — ลูกค้าไม่เคยได้รับคำตอบ
    const failed = await customer({ name: 'journey failed send', phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at('2026-09-07T00:00:00.000Z') });
    const failedRoom = await room(failed.id, 'failed', '2026-09-07T00:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: failedRoom.id, role: 'CUSTOMER', createdAt: at('2026-09-07T01:00:00.000Z') },
        { roomId: failedRoom.id, role: 'STAFF', createdAt: at('2026-09-07T03:00:00.000Z') },
      ],
    });
    await service.recompute([failed.id]);
    expect((await stateOf(failed.id)).firstStaffReplyAt).toBeNull();

    // (ค) ข้อความทักทายอัตโนมัติของเพจมาเป็น echo STAFF ใบแรกภายใน 60 วิ → ข้าม · คำตอบจริงจากเพจใบถัดไปนับ
    const greeted = await customer({ name: 'journey greeting echo', phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at('2026-09-08T00:00:00.000Z') });
    const greetedRoom = await room(greeted.id, 'greeting', '2026-09-08T00:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: greetedRoom.id, role: 'CUSTOMER', createdAt: at('2026-09-08T01:00:00.000Z') },
        { roomId: greetedRoom.id, role: 'STAFF', externalMessageId: mid('greeting'), createdAt: at('2026-09-08T01:00:05.000Z') },
        { roomId: greetedRoom.id, role: 'STAFF', externalMessageId: mid('greeting-reply'), createdAt: at('2026-09-08T01:40:00.000Z') },
      ],
    });
    await service.recompute([greeted.id]);
    expect((await stateOf(greeted.id)).firstStaffReplyAt?.toISOString()).toBe('2026-09-08T01:40:00.000Z');
  });

  it('ร้านตอบครั้งแรก: ข้าม echo ทั้งช่วงอัตโนมัติของเพจ — greeting หลาย bubble · echo บันทึกก่อนข้อความลูกค้า · away message ตอนลูกค้าทักรอบหลัง · ส่งจาก inbox ไม่ถูกข้าม', async () => {
    const mid = (label: string) => `journey-burst-${label}-${stamp}`;
    const chatCustomer = async (label: string, day: string) => {
      const c = await customer({ name: `journey burst ${label}`, phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at(`${day}T00:00:00.000Z`) });
      return { c, r: await room(c.id, `burst-${label}`, `${day}T00:00:00.000Z`) };
    };
    const firstReply = async (customerId: string) => {
      await service.recompute([customerId]);
      return (await stateOf(customerId)).firstStaffReplyAt?.toISOString() ?? null;
    };

    // greeting 2 bubble (instant reply + รูป) ห่างลูกค้า 2 และ 3 วิ → ข้ามทั้งคู่ · คนตอบจริง 40 นาทีต่อมานับ
    const twoBubble = await chatCustomer('two-bubble', '2026-08-20');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: twoBubble.r.id, role: 'CUSTOMER', createdAt: at('2026-08-20T01:00:00.000Z') },
        { roomId: twoBubble.r.id, role: 'STAFF', externalMessageId: mid('two-1'), createdAt: at('2026-08-20T01:00:02.000Z') },
        { roomId: twoBubble.r.id, role: 'STAFF', externalMessageId: mid('two-2'), createdAt: at('2026-08-20T01:00:03.000Z') },
        { roomId: twoBubble.r.id, role: 'STAFF', externalMessageId: mid('two-human'), createdAt: at('2026-08-20T01:40:00.000Z') },
      ],
    });
    expect(await firstReply(twoBubble.c.id)).toBe('2026-08-20T01:40:00.000Z');

    // echo ถูกบันทึกก่อนข้อความลูกค้าที่เป็นต้นเหตุ (routeInbound ไม่ await + ดึงโปรไฟล์ก่อน saveMessage) → ยังข้าม
    const echoFirst = await chatCustomer('echo-first', '2026-08-21');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: echoFirst.r.id, role: 'STAFF', externalMessageId: mid('race-greeting'), createdAt: at('2026-08-21T01:00:00.000Z') },
        { roomId: echoFirst.r.id, role: 'CUSTOMER', createdAt: at('2026-08-21T01:00:03.000Z') },
        { roomId: echoFirst.r.id, role: 'STAFF', externalMessageId: mid('race-human'), createdAt: at('2026-08-21T01:40:00.000Z') },
      ],
    });
    expect(await firstReply(echoFirst.c.id)).toBe('2026-08-21T01:40:00.000Z');

    // ช่วงอัตโนมัติยึดคำตอบใบแรกสุด: bubble ที่สองเลย 60 วิจากข้อความลูกค้าไปแล้ว แต่ยังอยู่ในช่วงเดียวกัน → ข้าม
    // · echo ที่ออกหลังคำตอบใบแรกสุดเกิน 60 วิ = ไม่ใช่ช่วงอัตโนมัติ → นับ
    const longBurst = await chatCustomer('long-burst', '2026-08-22');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: longBurst.r.id, role: 'CUSTOMER', createdAt: at('2026-08-22T01:00:00.000Z') },
        { roomId: longBurst.r.id, role: 'STAFF', externalMessageId: mid('long-1'), createdAt: at('2026-08-22T01:00:55.000Z') },
        { roomId: longBurst.r.id, role: 'STAFF', externalMessageId: mid('long-2'), createdAt: at('2026-08-22T01:01:10.000Z') },
        { roomId: longBurst.r.id, role: 'STAFF', externalMessageId: mid('long-human'), createdAt: at('2026-08-22T01:01:56.000Z') },
      ],
    });
    expect(await firstReply(longBurst.c.id)).toBe('2026-08-22T01:01:56.000Z');

    // ลูกค้าทักวันแรกไม่มีใครตอบ · ทักอีกทีวันที่สามแล้ว away message ยิงเป็นคำตอบใบแรกสุดของห้อง → ข้าม
    const away = await chatCustomer('away', '2026-08-23');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: away.r.id, role: 'CUSTOMER', createdAt: at('2026-08-23T01:00:00.000Z') },
        { roomId: away.r.id, role: 'CUSTOMER', createdAt: at('2026-08-25T14:00:00.000Z') },
        { roomId: away.r.id, role: 'STAFF', externalMessageId: mid('away-auto'), createdAt: at('2026-08-25T14:00:02.000Z') },
        { roomId: away.r.id, role: 'STAFF', externalMessageId: mid('away-human'), createdAt: at('2026-08-26T02:30:00.000Z') },
      ],
    });
    expect(await firstReply(away.c.id)).toBe('2026-08-26T02:30:00.000Z');

    // ส่งจาก inbox BESTCHOICE สำเร็จ (outbound_sent_at) ภายในนาทีแรก = คนกดส่ง → นับ แม้ echo greeting ข้างหน้าถูกข้าม
    const inboxFast = await chatCustomer('inbox-fast', '2026-08-24');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: inboxFast.r.id, role: 'CUSTOMER', createdAt: at('2026-08-24T01:00:00.000Z') },
        { roomId: inboxFast.r.id, role: 'STAFF', externalMessageId: mid('inbox-greeting'), createdAt: at('2026-08-24T01:00:02.000Z') },
        { roomId: inboxFast.r.id, role: 'STAFF', outboundSentAt: at('2026-08-24T01:00:20.000Z'), createdAt: at('2026-08-24T01:00:20.000Z') },
      ],
    });
    expect(await firstReply(inboxFast.c.id)).toBe('2026-08-24T01:00:20.000Z');
  });

  it('ทักเข้ามาแช่แข็ง: ห้องถูกนำเข้าใหม่ (created_at ใหม่กว่า ไม่มีข้อความ) → คำนวณใหม่ไม่เลื่อนไปข้างหลัง · CONTACT_ADDED → IDENTIFIED', async () => {
    const c = await customer({ name: 'journey frozen', phone: null, acquisitionSource: 'CHAT_LINE_SHOP', createdAt: at('2026-08-01T00:00:00.000Z') });
    const r = await room(c.id, 'frozen', '2026-08-01T00:00:00.000Z', 'LINE_SHOP');
    await service.recompute([c.id]);
    await prisma.chatRoom.update({ where: { id: r.id }, data: { createdAt: at('2026-09-01T00:00:00.000Z') } });
    await entry(c.id, 'CONTACT_ADDED', '2026-09-02T00:00:00.000Z', { origin: 'SYSTEM', dedupeKey: journeyDedupeKey('CONTACT_ADDED', c.id, 'phone') });
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect(s.contactedAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(s).toMatchObject({ stage: 'IDENTIFIED', firstChannel: 'CHAT_LINE_SHOP' });
    expect(s.identifiedAt?.toISOString()).toBe('2026-09-02T00:00:00.000Z');
  });

  it('HEARD_FROM ยกที่มาจาก WALK_IN · MARKED_LOST ติดป้าย · TOUCHPOINT หลังหลุดล้างป้าย', async () => {
    const c = await customer({ name: 'journey lost', phone: null, createdAt: at('2026-09-01T00:00:00.000Z') });
    await service.recompute([c.id]);
    expect((await stateOf(c.id)).firstSource).toBe('WALK_IN');
    await entry(c.id, 'HEARD_FROM', '2026-09-01T01:00:00.000Z', { heardFrom: 'FRIEND' });
    await entry(c.id, 'MARKED_LOST', '2026-09-03T00:00:00.000Z', { lostReason: 'UNREACHABLE' });
    await service.recompute([c.id]);
    const lost = await stateOf(c.id);
    expect(lost).toMatchObject({ firstSource: 'HEARD:FRIEND', heardFrom: 'FRIEND', lostReason: 'UNREACHABLE', stage: 'CONTACTED' });
    expect(lost.lostAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    await entry(c.id, 'TOUCHPOINT', '2026-09-04T00:00:00.000Z', { channel: 'PHONE', outcome: 'THINKING' });
    await service.recompute([c.id]);
    const back = await stateOf(c.id);
    expect(back).toMatchObject({ lostAt: null, lostReason: null, stage: 'CONTACTED' });
    expect(back.lastTouchAt?.toISOString()).toBe('2026-09-04T00:00:00.000Z');
  });

  it('นัด (todo ในห้อง) → INTERESTED · ใบตรวจเครดิต → CREDIT/INSTALLMENT · ใบขายสด → PURCHASED/CASH ตรงกับ BOUGHT_WHERE · ยกเลิกใบขาย → ถอยกลับ', async () => {
    const c = await customer({ name: 'journey buyer', phone: `082${tail}`, createdAt: at('2026-09-01T00:00:00.000Z') });
    const r = await room(c.id, 'buyer', '2026-09-01T01:00:00.000Z');
    const todo = await prisma.todo.create({ data: { title: 'นัดดูเครื่อง', createdById: userId, roomId: r.id, dueDate: at('2026-09-06T03:00:00.000Z'), createdAt: at('2026-09-02T00:00:00.000Z') } });
    todoIds.push(todo.id);
    await prisma.creditCheck.create({ data: { customerId: c.id, createdAt: at('2026-09-03T00:00:00.000Z') } });
    await service.recompute([c.id]);
    const credit = await stateOf(c.id);
    expect(credit).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT' });
    expect(credit.interestedAt?.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(credit.stageEnteredAt.toISOString()).toBe('2026-09-03T00:00:00.000Z');

    const parityBefore = await service.purchasedParity();
    const cash = await sale(c.id, 'CASH', '2026-09-04T00:00:00.000Z');
    await service.recompute([c.id]);
    const bought = await stateOf(c.id);
    expect(bought).toMatchObject({ stage: 'PURCHASED', path: 'CASH', firstPurchaseKind: 'CASH' });
    expect(bought.firstPurchaseAt?.toISOString()).toBe('2026-09-04T00:00:00.000Z');
    expect(await boughtLive(c.id)).toBe(true);
    expect(await service.purchasedParity()).toEqual({ purchasedStates: parityBefore.purchasedStates + 1, bought: parityBefore.bought + 1 });

    await prisma.sale.update({ where: { id: cash.id }, data: { deletedAt: at('2026-09-05T00:00:00.000Z') } });
    await service.recompute([c.id]);
    expect(await stateOf(c.id)).toMatchObject({ stage: 'CREDIT', firstPurchaseAt: null, firstPurchaseKind: null, path: 'INSTALLMENT' });
    expect(await boughtLive(c.id)).toBe(false);
  });

  it('สัญญาผ่อน: firstPurchaseAt = entry CONTRACT_ACTIVATED ถ้าเก่ากว่าใบขาย · สัญญาที่ไม่มี entry ใช้เวลาใบขาย', async () => {
    const c = await customer({ name: 'journey installment', phone: `083${tail}`, createdAt: at('2031-01-01T00:00:00.000Z') });
    const k1 = await contract(c.id, 'ACTIVE', '2031-01-01T01:00:00.000Z');
    const k2 = await contract(c.id, 'OVERDUE', '2031-01-01T02:00:00.000Z');
    await sale(c.id, 'INSTALLMENT', '2031-01-01T05:00:00.000Z', k1.id);
    await sale(c.id, 'INSTALLMENT', '2031-01-01T06:00:00.000Z', k2.id);
    await entry(c.id, 'CONTRACT_ACTIVATED', '2031-01-01T04:59:00.000Z', { origin: 'SYSTEM', refType: 'contract', refId: k1.id, dedupeKey: journeyDedupeKey('CONTRACT_ACTIVATED', k1.id) });
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect(s).toMatchObject({ stage: 'PURCHASED', path: 'INSTALLMENT', firstPurchaseKind: 'INSTALLMENT' });
    expect(s.firstPurchaseAt?.toISOString()).toBe('2031-01-01T04:59:00.000Z');
  });

  it('placeholder ที่รวมแล้ว: ห้อง/AI_LEAD_CAPTURED ขึ้นใต้คนจริง · ไม่มีแคชของ placeholder', async () => {
    const target = await customer({ name: 'journey target', phone: `084${tail}`, createdAt: at('2026-09-08T00:00:00.000Z') });
    const placeholder = await customer({
      name: 'journey placeholder', phone: null, acquisitionSource: 'CHAT_LINE_SHOP', createdAt: at('2026-09-02T00:00:00.000Z'),
      deletedAt: at('2026-09-09T00:00:00.000Z'), mergedIntoId: target.id,
    });
    await room(target.id, 'merged', '2026-09-02T00:00:00.000Z', 'LINE_SHOP');
    await prisma.auditLog.create({ data: { userId, action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: placeholder.id, createdAt: at('2026-09-03T05:00:00.000Z') } });
    await service.recompute([target.id, placeholder.id]);
    const s = await stateOf(target.id);
    expect(s).toMatchObject({ stage: 'INTERESTED', firstChannel: 'CHAT_LINE_SHOP', firstSource: 'CHAT_LINE_SHOP' });
    expect(s.contactedAt.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(s.interestedAt?.toISOString()).toBe('2026-09-03T05:00:00.000Z');
    expect(s.identifiedAt?.toISOString()).toBe('2026-09-08T00:00:00.000Z');
    expect(await prisma.customerJourneyState.count({ where: { customerId: placeholder.id } })).toBe(0);
  });

  it('บันทึกที่ค้างใต้ id ของ placeholder ที่รวมแล้ว (เช่น ถอย image ระหว่างทาง) ยังนับเข้าแคชของคนจริงผ่าน family', async () => {
    const target = await customer({ name: 'journey family target', phone: null, createdAt: at('2026-09-08T00:00:00.000Z') });
    const placeholder = await customer({
      name: 'journey family placeholder', phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at('2026-09-02T00:00:00.000Z'),
      deletedAt: at('2026-09-09T00:00:00.000Z'), mergedIntoId: target.id,
    });
    // entries ยังอยู่ใต้ placeholder.id — ไม่ถูกย้ายไปใต้ target
    await entry(placeholder.id, 'CONTACT_ADDED', '2026-09-05T00:00:00.000Z', { origin: 'SYSTEM', dedupeKey: journeyDedupeKey('CONTACT_ADDED', placeholder.id, 'family', stamp) });
    await entry(placeholder.id, 'TOUCHPOINT', '2026-09-06T00:00:00.000Z', { channel: 'PHONE', outcome: 'APPOINTED' });
    await entry(placeholder.id, 'HEARD_FROM', '2026-09-06T01:00:00.000Z', { heardFrom: 'FRIEND' });
    await service.recompute([target.id]);
    const s = await stateOf(target.id);
    expect(s).toMatchObject({ stage: 'INTERESTED', heardFrom: 'FRIEND', firstSource: 'HEARD:FRIEND' });
    // ถ้าอ่าน entries เฉพาะ target: identifiedAt = เวลารวม (09-09) · interestedAt/heardFrom ว่าง · ขั้น IDENTIFIED
    expect(s.identifiedAt?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    expect(s.interestedAt?.toISOString()).toBe('2026-09-06T00:00:00.000Z');
    expect(s.lastTouchAt?.toISOString()).toBe('2026-09-06T00:00:00.000Z');
  });

  it('ลูกค้าที่ถูกลบ/ถูกรวมแล้ว: recompute ไม่สร้างแคชและลบแคชเดิม · id ว่าง/ซ้ำไม่พัง (สัญญาที่ Task 4 พึ่ง)', async () => {
    const c = await customer({ name: 'journey removed', phone: null, createdAt: at('2026-09-01T00:00:00.000Z') });
    await service.recompute([c.id]);
    expect(await prisma.customerJourneyState.count({ where: { customerId: c.id } })).toBe(1);
    await prisma.customer.update({ where: { id: c.id }, data: { deletedAt: at('2026-09-02T00:00:00.000Z') } });
    await service.recompute([c.id, c.id, '']);
    expect(await prisma.customerJourneyState.count({ where: { customerId: c.id } })).toBe(0);
    await expect(service.recompute([])).resolves.toBeUndefined();
  });
});
