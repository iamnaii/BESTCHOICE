import { PrismaClient } from '@prisma/client';
import type { JourneyRedirect, JourneySummary } from '@installment/shared';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';

/** URL สังเคราะห์: ไฟล์เอกสาร (ตรง CUSTOMER_DOCUMENT_FILE_SQL) · ลิงก์แชร์ที่ webhook Facebook เก็บเป็น FILE (ไม่ตรง — คำตัดสินผู้ควบคุม R-P1) */
const DOC_URL = 'https://files.example.test/journey-phase3/statement.pdf';
const SHARE_LINK = 'https://www.facebook.com/share/p/journey-phase3/';

/**
 * เฟส 3 Task 4 กับ Postgres จริง: ธง askHeardFrom · ขั้นเครดิต not_needed · หลักฐาน CHAT_FILE · creditFilePending · นับเฉพาะไฟล์เอกสาร (R-P1)
 * ใช้เวลาแบบ ISO UTC เท่านั้น (CI เป็น UTC · เครื่องเป็น Asia/Bangkok) · ผู้ใช้/สาขาของ spec ถูกปล่อยไว้เพราะ audit_logs ลบไม่ได้
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('JourneySummaryService phase 3 flags (real DB)', () => {
  const prisma = new PrismaClient();
  const state = new JourneyStateService(prisma as any);
  const service = new JourneySummaryService(prisma as any, state);
  const actor = { id: 'phase3-sales', role: 'SALES' };
  const accountant = { id: 'phase3-accountant', role: 'ACCOUNTANT' };
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (value: string) => new Date(value);
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const saleIds: string[] = [];
  let branchId: string;
  let productId: string;
  let userId: string;

  function asSummary(res: JourneySummary | JourneyRedirect): JourneySummary {
    if (!('steps' in res)) throw new Error('คาดว่าเป็น JourneySummary');
    return res;
  }
  const creditStep = (s: JourneySummary) => s.steps.find((x) => x.stage === 'CREDIT');

  async function walkIn(label: string, phone: string) {
    const row = await prisma.customer.create({ data: { name: `phase3 ${label}`, phone } });
    customerIds.push(row.id);
    return row;
  }
  async function chatProspect(label: string, createdAt: string) {
    const customer = await prisma.customer.create({
      data: { name: `phase3 ${label}`, phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: at(createdAt) },
    });
    customerIds.push(customer.id);
    const room = await prisma.chatRoom.create({
      data: { channel: 'FACEBOOK', externalUserId: `phase3-${label}-${stamp}`, customerId: customer.id, createdAt: at(createdAt) },
    });
    roomIds.push(room.id);
    return { customer, room };
  }
  async function cashSale(customerId: string) {
    const row = await prisma.sale.create({
      data: { saleNumber: `JP3-${tail}-${saleIds.length}`, saleType: 'CASH', customerId, productId, branchId, salespersonId: userId, sellingPrice: 9900, netAmount: 9900 },
    });
    saleIds.push(row.id);
  }

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `phase3 summary spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-phase3-${stamp}@spec.local`, password: 'x', name: 'phase3 summary spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'phase3 phone', brand: 'Apple', model: 'iPhone 13', category: 'PHONE_USED', costPrice: 8000, branchId } })).id;
  });
  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('ลูกค้าหน้าร้านยังไม่ตอบ → askHeardFrom · บันทึก HEARD_FROM แล้วคำนวณใหม่ → ธงดับ', async () => {
    const c = await walkIn('heard', `061${tail}`);
    expect(asSummary(await service.summary(c.id, actor))).toMatchObject({ firstSource: 'WALK_IN', heardFrom: null, askHeardFrom: true });

    await prisma.customerJourneyEntry.create({
      data: { customerId: c.id, originCustomerId: c.id, origin: 'MANUAL', kind: 'HEARD_FROM', heardFrom: 'FRIEND', occurredAt: new Date(), actorType: 'STAFF', actorUserId: userId },
    });
    await state.recompute([c.id]);
    expect(asSummary(await service.summary(c.id, actor))).toMatchObject({ firstSource: 'HEARD:FRIEND', heardFrom: 'FRIEND', askHeardFrom: false });
  });

  it('ซื้อเงินสดโดยไม่มีหลักฐานเครดิต → ขั้นเครดิต not_needed · ซื้อครั้งแรกยังถามรู้จักร้าน · ครั้งที่ 2 ไม่ถาม', async () => {
    const c = await walkIn('cash', `062${tail}`);
    await cashSale(c.id);
    const first = asSummary(await service.summary(c.id, actor));
    expect(first).toMatchObject({ stage: 'PURCHASED', path: 'CASH', askHeardFrom: true, creditFilePending: false });
    expect(creditStep(first)).toMatchObject({ state: 'not_needed', at: null, evidence: 'SYSTEM' });
    expect(first.steps.filter((x) => x.state === 'not_needed').map((x) => x.stage)).toEqual(['CREDIT']);

    await cashSale(c.id);
    expect(asSummary(await service.summary(c.id, actor))).toMatchObject({ stage: 'PURCHASED', askHeardFrom: false });
  });

  it('ผู้สนใจที่ส่งไฟล์ในแชทอย่างเดียว → ขั้นเครดิต current หลักฐาน CHAT_FILE · creditFilePending · ทุก role ได้ค่าเดียวกัน', async () => {
    const { customer, room } = await chatProspect('file-only', '2026-09-12T02:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: room.id, role: 'CUSTOMER', createdAt: at('2026-09-12T02:30:00.000Z') },
        { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: SHARE_LINK, createdAt: at('2026-09-12T02:31:00.000Z') }, // ลิงก์แชร์มาก่อน ไม่นับ
        { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-12T02:32:00.000Z') },
        { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-12T02:35:00.000Z') },
      ],
    });

    for (const who of [actor, accountant]) {
      const s = asSummary(await service.summary(customer.id, who));
      expect(s).toMatchObject({ stage: 'CREDIT', path: 'UNKNOWN', askHeardFrom: false, creditFilePending: true });
      expect(creditStep(s)).toMatchObject({ state: 'current', at: '2026-09-12T02:32:00.000Z', evidence: 'CHAT_FILE' });
    }
  });

  it('ใบตรวจเครดิตมาก่อนไฟล์ในแชท → หลักฐาน SYSTEM · path INSTALLMENT · ลูกค้ามีสถานะเครดิตแล้ว creditFilePending ดับ', async () => {
    const { customer, room } = await chatProspect('check-first', '2026-09-04T02:00:00.000Z');
    await prisma.chatMessage.create({ data: { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: DOC_URL, createdAt: at('2026-09-10T03:00:00.000Z') } });
    await prisma.creditCheck.create({ data: { customerId: customer.id, createdAt: at('2026-09-05T03:00:00.000Z') } });
    await prisma.customer.update({ where: { id: customer.id }, data: { creditCheckStatus: 'UNDER_REVIEW' } });

    const s = asSummary(await service.summary(customer.id, actor));
    expect(s).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT', creditFilePending: false });
    expect(creditStep(s)).toMatchObject({ state: 'current', at: '2026-09-05T03:00:00.000Z', evidence: 'SYSTEM' });
  });

  it('ไฟล์ที่ไม่ใช่เอกสาร (media_url ว่าง · ลิงก์แชร์ facebook.com) → ไม่ขึ้นขั้นเครดิต · creditFilePending ดับ · ใบตรวจเครดิตเวลาเดียวกับลิงก์แชร์พอดี หลักฐานยังเป็น SYSTEM', async () => {
    const { customer, room } = await chatProspect('share-only', '2026-09-13T02:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: [
        { roomId: room.id, role: 'CUSTOMER', createdAt: at('2026-09-13T02:30:00.000Z') },
        { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: null, createdAt: at('2026-09-13T02:32:00.000Z') },
        { roomId: room.id, role: 'CUSTOMER', type: 'FILE', mediaUrl: SHARE_LINK, createdAt: at('2026-09-13T02:35:00.000Z') },
      ],
    });
    const before = asSummary(await service.summary(customer.id, actor));
    expect(before).toMatchObject({ stage: 'CONTACTED', creditFilePending: false });
    expect(creditStep(before)).toMatchObject({ state: 'todo', at: null, evidence: 'SYSTEM' });

    // เวลาเท่ากับลิงก์แชร์พอดี ⇒ ถ้าคิวรีเทียบเวลาไม่ผ่านเงื่อนไขไฟล์เอกสาร หลักฐานจะกลายเป็น CHAT_FILE ผิด ๆ
    await prisma.creditCheck.create({ data: { customerId: customer.id, createdAt: at('2026-09-13T02:35:00.000Z') } });
    await state.recompute([customer.id]);
    const after = asSummary(await service.summary(customer.id, actor));
    expect(after).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT', creditFilePending: false });
    expect(creditStep(after)).toMatchObject({ state: 'current', at: '2026-09-13T02:35:00.000Z', evidence: 'SYSTEM' });
  });
});
