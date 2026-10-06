import { Prisma, PrismaClient } from '@prisma/client';
import { CUSTOMER_DOCUMENT_FILE_FRAGMENT } from './chat-document-file';
import { JourneyStateService } from './journey-state.service';

/** เอกสาร 6 ชนิดที่ล้างป้ายหลุดเมื่อเกิดหลังติดป้าย (คำตัดสินเจ้าของ 2026-09-15 ข้อ 5 + 12) — ชุดเดียวกับ interest_agg.doc_last_at */
type ClearingDoc = 'booking' | 'onlineApplication' | 'productReservation' | 'tradeIn' | 'savingPlan' | 'onlineOrder';
const CLEARING_DOCS: ClearingDoc[] = ['booking', 'onlineApplication', 'productReservation', 'tradeIn', 'savingPlan', 'onlineOrder'];
/** URL สังเคราะห์: ไฟล์เอกสาร (ตรง CUSTOMER_DOCUMENT_FILE_SQL) · ลิงก์แชร์ที่ webhook Facebook เก็บเป็น FILE (ไม่ตรง — คำตัดสินผู้ควบคุม R-P1) */
const DOC_URL = 'https://files.example.test/journey-signals/statement.pdf';
const SHARE_LINK = 'https://www.facebook.com/share/p/journey-signals/';

/**
 * สัญญาณอัตโนมัติเฟส 3 ใน journey-state.sql กับ Postgres จริง (คำตัดสินเจ้าของ 2026-09-15 ข้อ 5 · 11 · 12 · 13)
 * - ไฟล์เอกสารที่ลูกค้าส่งในแชท (R-P1: pdf / doc / xls) → ขั้น 3 ตรวจเครดิต โดยไม่ตั้ง path · media_url ว่าง / ลิงก์แชร์ / รูป ไม่นับ
 * - แผนออมเครื่อง / คำสั่งซื้อออนไลน์ → หลักฐานขั้น 4 นัด / จอง
 * - เอกสาร 6 ชนิดหลังติดป้ายหลุด → ล้างป้าย · นัดหมาย / ใบตรวจเครดิต / สัญญา ไม่ล้าง
 * - ตัวตรวจความเคลื่อนไหวเห็นสองตารางใหม่
 * ข้อมูลสังเคราะห์ทั้งหมด · audit_logs ลบไม่ได้ (trigger) ⇒ ผู้ใช้ของ spec ถูกปล่อยไว้ ตามแบบ journey-state.service.db.spec.ts
 * ใบจองทุกใบในไฟล์นี้ status EXPIRED (ห้ามถอด): product_reservations มี partial unique index product_reservations_active_product_idx
 *   (product_id WHERE status = 'ACTIVE' — migration 20260986000000) และทุกใบใช้ productId เดียวกัน ⇒ ACTIVE ใบที่สองชน P2002 ·
 *   interest_agg / doc_last_at นับใบจองทุกสถานะ จึงไม่เปลี่ยนผลของเทส
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('JourneyStateService — สัญญาณอัตโนมัติเฟส 3 (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new JourneyStateService(prisma as any);
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (value: string) => new Date(value);
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const todoIds: string[] = [];
  const contractIds: string[] = [];
  const bookingIds: string[] = [];
  const applicationIds: string[] = [];
  const reservationIds: string[] = [];
  const tradeInIds: string[] = [];
  const savingPlanIds: string[] = [];
  const orderIds: string[] = [];
  let seq = 0;
  let branchId: string;
  let productId: string;
  let userId: string;

  /** เลขเอกสารไม่ซ้ำข้ามรอบรัน (tail) และภายในรอบ (seq) */
  const docNo = (prefix: string) => `${prefix}-${tail}-${seq++}`;
  const recomputed = async (customerId: string) => {
    await service.recompute([customerId]);
    return prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId } });
  };

  /** ไม่มีเบอร์ · chat = ผู้สนใจจากแชท Facebook · ไม่ใช่ chat = ลูกค้าหน้าร้าน (WALK_IN) */
  async function customer(label: string, chat = false) {
    const row = await prisma.customer.create({
      data: {
        name: `journey signals ${label}`, phone: null, createdAt: at('2026-09-01T00:00:00.000Z'),
        ...(chat ? { acquisitionSource: 'CHAT_FACEBOOK' } : {}),
      },
    });
    customerIds.push(row.id);
    return row;
  }
  async function room(customerId: string, label: string) {
    const row = await prisma.chatRoom.create({
      data: { channel: 'FACEBOOK', externalUserId: `journey-signals-${label}-${stamp}`, customerId, createdAt: at('2026-09-01T00:00:00.000Z') },
    });
    roomIds.push(row.id);
    return row;
  }
  async function markLost(customerId: string, occurredAt: string) {
    await prisma.customerJourneyEntry.create({
      data: {
        customerId, originCustomerId: customerId, origin: 'MANUAL', kind: 'MARKED_LOST', lostReason: 'NOT_INTERESTED',
        occurredAt: at(occurredAt), actorType: 'STAFF',
      },
    });
  }
  /** status EXPIRED เสมอ — ACTIVE ได้ใบเดียวต่อเครื่อง (product_reservations_active_product_idx) · ดู docblock ของ describe */
  async function reservation(customerId: string | null, reservedAt: string) {
    const row = await prisma.productReservation.create({
      data: { productId, customerId, sessionId: docNo('journey-signals-session'), status: 'EXPIRED', reservedAt: at(reservedAt), expiresAt: at('2026-12-31T00:00:00.000Z') },
    });
    reservationIds.push(row.id);
    return row;
  }
  async function savingPlan(customerId: string, createdAt: string) {
    const row = await prisma.savingPlan.create({
      data: {
        planNumber: docNo('JSP'), customerId, targetAmount: 30000, monthlyAmount: 3000, durationMonths: 10,
        startedAt: at(createdAt), createdAt: at(createdAt),
      },
    });
    savingPlanIds.push(row.id);
    return row;
  }
  async function onlineOrder(customerId: string, createdAt: string) {
    // ใบจองของคำสั่งซื้อไม่ผูกลูกค้า (placeOrder รับใบจองนิรนามได้) ⇒ หลักฐานมาจากคำสั่งซื้ออย่างเดียว
    const hold = await reservation(null, createdAt);
    const row = await prisma.onlineOrder.create({
      data: {
        orderNumber: docNo('JOO'), customerId, productId, reservationId: hold.id, productPrice: 25000, totalAmount: 25000,
        shippingMethod: 'BRANCH_PICKUP', paymentChannel: 'PROMPTPAY_QR', status: 'PENDING_PAYMENT', createdAt: at(createdAt),
      },
    });
    orderIds.push(row.id);
    return row;
  }
  async function clearingDoc(kind: ClearingDoc, customerId: string, when: string) {
    switch (kind) {
      case 'booking': {
        const row = await prisma.booking.create({
          data: {
            bookingNumber: docNo('JBK'), customerId, branchId, depositAmount: 1000, totalAmount: 25000,
            expireDate: at('2026-12-31T00:00:00.000Z'), createdById: userId, createdAt: at(when),
          },
        });
        bookingIds.push(row.id);
        return;
      }
      case 'onlineApplication': {
        const row = await prisma.onlineInstallmentApplication.create({
          data: {
            applicationNumber: docNo('JAP'), customerId, productId, fullName: 'journey signals applicant', phone: '0860000000', nationalId: '0000000000000',
            proposedDownPayment: 5000, proposedTotalMonths: 10, proposedMonthlyPayment: 2400, createdAt: at(when),
          },
        });
        applicationIds.push(row.id);
        return;
      }
      case 'productReservation':
        await reservation(customerId, when);
        return;
      case 'tradeIn': {
        const row = await prisma.tradeIn.create({ data: { customerId, deviceBrand: 'Apple', deviceModel: 'iPhone 13', createdAt: at(when) } });
        tradeInIds.push(row.id);
        return;
      }
      case 'savingPlan':
        await savingPlan(customerId, when);
        return;
      case 'onlineOrder':
        await onlineOrder(customerId, when);
        return;
    }
  }

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `journey signals spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-signals-${stamp}@spec.local`, password: 'x', name: 'journey signals spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'journey signals phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId } })).id;
  });

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.todo.deleteMany({ where: { id: { in: todoIds } } });
    await prisma.onlineOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.productReservation.deleteMany({ where: { id: { in: reservationIds } } });
    await prisma.savingPlan.deleteMany({ where: { id: { in: savingPlanIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.onlineInstallmentApplication.deleteMany({ where: { id: { in: applicationIds } } });
    await prisma.tradeIn.deleteMany({ where: { id: { in: tradeInIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.branch.deleteMany({ where: { id: branchId } });
    await prisma.$disconnect();
  });

  describe('ไฟล์ที่ลูกค้าส่งในแชท → ขั้น 3 ตรวจเครดิต (ไม่ตั้ง path)', () => {
    it('ไฟล์เอกสารของ CUSTOMER อย่างเดียว → CREDIT · creditAt = ไฟล์เอกสารแรก (ลิงก์แชร์ที่มาก่อนไม่นับ) · path UNKNOWN · ไม่ขึ้นขั้นอื่น', async () => {
      const c = await customer('file only', true);
      const r = await room(c.id, 'file-only');
      await prisma.chatMessage.createMany({
        data: [
          { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-10T01:00:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: SHARE_LINK, createdAt: at('2026-09-10T01:02:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-10T01:05:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-11T02:00:00.000Z') },
        ],
      });
      const s = await recomputed(c.id);
      expect(s).toMatchObject({ stage: 'CREDIT', path: 'UNKNOWN', identifiedAt: null, interestedAt: null, firstPurchaseAt: null });
      expect(s.creditAt?.toISOString()).toBe('2026-09-10T01:05:00.000Z');
      expect(s.stageEnteredAt.toISOString()).toBe('2026-09-10T01:05:00.000Z');
    });

    it('ไฟล์ที่ไม่ใช่เอกสาร (media_url ว่าง · ลิงก์แชร์ facebook.com · รูป .jpg) ไม่นับ → คงขั้น CONTACTED · creditAt ว่าง', async () => {
      const c = await customer('non-document files', true);
      const r = await room(c.id, 'non-document');
      await prisma.chatMessage.createMany({
        data: [
          { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-10T01:00:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: null, createdAt: at('2026-09-10T01:05:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: SHARE_LINK, createdAt: at('2026-09-10T01:06:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/photo.jpg', createdAt: at('2026-09-10T01:07:00.000Z') },
        ],
      });
      expect(await recomputed(c.id)).toMatchObject({ stage: 'CONTACTED', path: 'UNKNOWN', creditAt: null });
    });

    it('ไฟล์ของ STAFF และรูปภาพของลูกค้า ไม่นับแม้ลิงก์ลงท้าย .pdf → คงขั้น CONTACTED · creditAt ว่าง', async () => {
      const c = await customer('staff file and customer image', true);
      const r = await room(c.id, 'staff-file');
      await prisma.chatMessage.createMany({
        data: [
          { roomId: r.id, role: 'CUSTOMER', createdAt: at('2026-09-10T01:00:00.000Z') },
          { roomId: r.id, role: 'STAFF', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-10T01:10:00.000Z'), outboundSentAt: at('2026-09-10T01:10:00.000Z') },
          { roomId: r.id, role: 'CUSTOMER', type: 'IMAGE', mediaUrl: DOC_URL, createdAt: at('2026-09-10T01:20:00.000Z') },
        ],
      });
      expect(await recomputed(c.id)).toMatchObject({ stage: 'CONTACTED', path: 'UNKNOWN', creditAt: null });
    });

    it('ไฟล์เอกสารของลูกค้าที่ถูก soft-delete (retention) ยังนับ', async () => {
      const c = await customer('deleted file', true);
      const r = await room(c.id, 'deleted-file');
      await prisma.chatMessage.create({
        data: { roomId: r.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-10T03:00:00.000Z'), deletedAt: at('2026-09-12T00:00:00.000Z') },
      });
      const s = await recomputed(c.id);
      expect(s).toMatchObject({ stage: 'CREDIT', path: 'UNKNOWN' });
      expect(s.creditAt?.toISOString()).toBe('2026-09-10T03:00:00.000Z');
    });

    it('ไฟล์เอกสาร + ใบตรวจเครดิต → path INSTALLMENT · creditAt = อันที่มาก่อน (ทั้งสองทิศ)', async () => {
      const fileFirst = await customer('file then credit check', true);
      const r1 = await room(fileFirst.id, 'file-then-check');
      await prisma.chatMessage.create({ data: { roomId: r1.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-02T03:00:00.000Z') } });
      await prisma.creditCheck.create({ data: { customerId: fileFirst.id, createdAt: at('2026-09-03T00:00:00.000Z') } });
      const a = await recomputed(fileFirst.id);
      expect(a).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT' });
      expect(a.creditAt?.toISOString()).toBe('2026-09-02T03:00:00.000Z');

      const checkFirst = await customer('credit check then file', true);
      const r2 = await room(checkFirst.id, 'check-then-file');
      await prisma.creditCheck.create({ data: { customerId: checkFirst.id, createdAt: at('2026-09-02T00:00:00.000Z') } });
      await prisma.chatMessage.create({ data: { roomId: r2.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-04T00:00:00.000Z') } });
      const b = await recomputed(checkFirst.id);
      expect(b).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT' });
      expect(b.creditAt?.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    });
  });

  describe('แผนออมเครื่อง / คำสั่งซื้อออนไลน์ → ขั้น 4 นัด / จอง', () => {
    it('แผนออมเครื่อง → INTERESTED · interestedAt = เวลาสร้างแผน · แผนที่ถูกลบไม่นับ', async () => {
      const c = await customer('saving plan');
      const plan = await savingPlan(c.id, '2026-09-05T02:00:00.000Z');
      const s = await recomputed(c.id);
      expect(s.stage).toBe('INTERESTED');
      expect(s.interestedAt?.toISOString()).toBe('2026-09-05T02:00:00.000Z');
      expect(s.stageEnteredAt.toISOString()).toBe('2026-09-05T02:00:00.000Z');

      await prisma.savingPlan.update({ where: { id: plan.id }, data: { deletedAt: at('2026-09-06T00:00:00.000Z') } });
      expect(await recomputed(c.id)).toMatchObject({ stage: 'CONTACTED', interestedAt: null });
    });

    it('คำสั่งซื้อออนไลน์ (ใบจองของคำสั่งซื้อไม่ผูกลูกค้า) → INTERESTED · interestedAt = เวลาสั่งซื้อ', async () => {
      const c = await customer('online order');
      await onlineOrder(c.id, '2026-09-07T04:00:00.000Z');
      const s = await recomputed(c.id);
      expect(s.stage).toBe('INTERESTED');
      expect(s.interestedAt?.toISOString()).toBe('2026-09-07T04:00:00.000Z');
    });
  });

  describe('ป้ายหลุด: เอกสาร 6 ชนิดหลังติดป้ายล้างป้าย · อย่างอื่นไม่ล้าง', () => {
    it.each(CLEARING_DOCS)('%s หลังติดป้ายหลุด → lostAt / lostReason ว่าง', async (kind) => {
      const c = await customer(`lost then ${kind}`);
      await markLost(c.id, '2026-09-03T00:00:00.000Z');
      expect((await recomputed(c.id)).lostAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');

      await clearingDoc(kind, c.id, '2026-09-04T00:00:00.000Z');
      expect(await recomputed(c.id)).toMatchObject({ lostAt: null, lostReason: null, stage: 'INTERESTED' });
    });

    it.each(CLEARING_DOCS)('%s ก่อนติดป้ายหลุด → ยังหลุด', async (kind) => {
      const c = await customer(`${kind} then lost`);
      await clearingDoc(kind, c.id, '2026-09-02T00:00:00.000Z');
      await markLost(c.id, '2026-09-03T00:00:00.000Z');
      const s = await recomputed(c.id);
      expect(s).toMatchObject({ lostReason: 'NOT_INTERESTED', stage: 'INTERESTED' });
      expect(s.lostAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    });

    it('เอกสารเวลาเดียวกับป้ายพอดี → ยังหลุด (กติกาเดียวกับข้อความลูกค้า / TOUCHPOINT)', async () => {
      const c = await customer('document at mark');
      await markLost(c.id, '2026-09-03T00:00:00.000Z');
      await clearingDoc('savingPlan', c.id, '2026-09-03T00:00:00.000Z');
      expect((await recomputed(c.id)).lostAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    });

    it('นัดหมาย (todo มีวันนัด) / ใบตรวจเครดิต / สัญญาร่าง หลังติดป้าย → ยังหลุด แม้ขั้นจะขยับ', async () => {
      const c = await customer('lost then staff documents', true);
      const r = await room(c.id, 'lost-staff-docs');
      await markLost(c.id, '2026-09-03T00:00:00.000Z');
      const todo = await prisma.todo.create({
        data: { title: 'นัดดูเครื่อง', createdById: userId, roomId: r.id, dueDate: at('2026-09-08T03:00:00.000Z'), createdAt: at('2026-09-04T00:00:00.000Z') },
      });
      todoIds.push(todo.id);
      await prisma.creditCheck.create({ data: { customerId: c.id, createdAt: at('2026-09-05T00:00:00.000Z') } });
      const draft = await prisma.contract.create({
        data: {
          contractNumber: docNo('JSC'), customerId: c.id, productId, branchId, salespersonId: userId, planType: 'STORE_WITH_INTEREST',
          sellingPrice: 25000, downPayment: 5000, interestRate: 0.02, totalMonths: 10, interestTotal: 4000, financedAmount: 20000, monthlyPayment: 2400,
          status: 'DRAFT', createdAt: at('2026-09-06T00:00:00.000Z'),
        },
      });
      contractIds.push(draft.id);
      const s = await recomputed(c.id);
      expect(s).toMatchObject({ stage: 'INTERESTED', path: 'INSTALLMENT', lostReason: 'NOT_INTERESTED' });
      expect(s.lostAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    });
  });

  describe('ตัวตรวจความเคลื่อนไหวเห็นแผนออมเครื่อง / คำสั่งซื้อออนไลน์', () => {
    it.each(['savingPlan', 'onlineOrder'] as const)('%s ใหม่ → hasActivitySince จริง · activeCustomerIdsSince มีลูกค้า', async (kind) => {
      const c = await customer(`probe ${kind}`);
      // updated_at ของลูกค้าต้องมาก่อน since และของเอกสารต้องมาหลัง since (timestamp(3) — กันค่าชนกันในมิลลิวินาทีเดียวกัน)
      await pause(20);
      const since = new Date();
      await pause(20);
      expect(await service.hasActivitySince([c.id], since)).toBe(false);
      expect(await service.activeCustomerIdsSince(since)).not.toContain(c.id);

      await clearingDoc(kind, c.id, '2026-09-04T00:00:00.000Z');
      expect(await service.hasActivitySince([c.id], since)).toBe(true);
      expect(await service.activeCustomerIdsSince(since)).toContain(c.id);
    });
  });

  describe('เงื่อนไขไฟล์เอกสาร (CUSTOMER_DOCUMENT_FILE_FRAGMENT) กับ Postgres จริง', () => {
    it('นับ: pdf / doc / docx / xls / xlsx ไม่สนตัวพิมพ์ มี query string ได้ · ไม่นับ: media_url ว่าง · ลิงก์แชร์ · รูป · นามสกุลที่แค่ขึ้นต้นเหมือน · ไฟล์ของร้าน · ชนิดอื่น', async () => {
      const cases = [
        { label: 'pdf', role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, counts: true },
        { label: 'PDF ตัวใหญ่', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/STATEMENT.PDF', counts: true },
        { label: 'pdf + query', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://cdn.example.test/v/journey-signals/slip.pdf?_nc_cat=1&oh=abc', counts: true },
        { label: 'doc', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/old.doc', counts: true },
        { label: 'docx', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/bank.docx', counts: true },
        { label: 'xls + query', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/sheet.xls?dl=1', counts: true },
        { label: 'xlsx', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/sheet.xlsx', counts: true },
        { label: 'media_url ว่าง', role: 'CUSTOMER', type: 'FILE', mediaUrl: null, counts: false },
        { label: 'ลิงก์แชร์ facebook.com', role: 'CUSTOMER', type: 'FILE', mediaUrl: SHARE_LINK, counts: false },
        { label: 'jpg', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/photo.jpg', counts: false },
        { label: 'pdfx', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/statement.pdfx', counts: false },
        { label: 'pdf.zip', role: 'CUSTOMER', type: 'FILE', mediaUrl: 'https://files.example.test/journey-signals/statement.pdf.zip', counts: false },
        { label: 'ไฟล์ของร้าน', role: 'STAFF', type: 'FILE', mediaUrl: DOC_URL, counts: false },
        { label: 'รูปของลูกค้า', role: 'CUSTOMER', type: 'IMAGE', mediaUrl: DOC_URL, counts: false },
      ];
      // เงื่อนไขเดียวกับที่ journey-state.sql เขียนตรงตัวอักษร (chat-document-file.spec.ts ปักไว้) และที่ Task 4 / 5 ใช้ใน $queryRaw
      const rows = await prisma.$queryRaw<Array<{ label: string; counts: boolean }>>`
        SELECT m.label, COALESCE(${CUSTOMER_DOCUMENT_FILE_FRAGMENT}, false) AS counts
        FROM (VALUES ${Prisma.join(cases.map((c) => Prisma.sql`(${c.label}::text, ${c.role}::text, ${c.type}::text, ${c.mediaUrl}::text)`))}) AS m(label, role, type, media_url)`;
      expect(Object.fromEntries(rows.map((row) => [row.label, row.counts]))).toEqual(Object.fromEntries(cases.map((c) => [c.label, c.counts])));
    });
  });
});
