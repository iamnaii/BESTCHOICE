import { PrismaClient } from '@prisma/client';
import { JourneyStateService } from './journey-state.service';
import { withLiveBought } from './journey-summary.builder';

/**
 * ลำดับขั้นกับ Postgres จริง — ③ ตรวจเครดิต มาก่อน ④ นัด / จอง (เจ้าของสั่ง 2026-09-15 "ต้องเช็คเครดิตก่อนนัด")
 * ขั้นปัจจุบัน = ขั้นสูงสุดที่มีหลักฐานตาม JOURNEY_STAGES ไม่ใช่หลักฐานล่าสุดตามเวลา · stage_entered_at = เวลาของขั้นนั้นเอง
 * CI รัน UTC · เครื่อง dev รัน Asia/Bangkok ⇒ ใช้เวลา ISO ที่ลงท้าย Z เท่านั้น ห้ามสตริงเวลาท้องถิ่น
 * audit_logs ลบไม่ได้ (trigger audit_logs_no_delete) ⇒ ผู้ใช้/สาขาของ spec ถูกปล่อยไว้ ตามแบบ journey-state.service.db.spec.ts
 * รัน: DATABASE_URL=<ฐานทดสอบ> TZ=Asia/Bangkok npx jest <ไฟล์นี้> --runInBand
 */
describe('JourneyStateService — ลำดับขั้น ตรวจเครดิต → นัด / จอง (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new JourneyStateService(prisma as any);
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (value: string) => new Date(value);
  const iso = (value: Date | null) => (value ? value.toISOString() : null);
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const todoIds: string[] = [];
  const saleIds: string[] = [];
  let branchId: string;
  let productId: string;
  let userId: string;

  const stateOf = (customerId: string) => prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId } });

  async function customer(label: string) {
    const row = await prisma.customer.create({ data: { name: `journey order ${label}`, phone: null, createdAt: at('2026-09-01T00:00:00.000Z') } });
    customerIds.push(row.id);
    return row;
  }
  /** นัดในห้องแชท (todo ที่มี due_date) = หลักฐานขั้น 4 นัด / จอง */
  async function appointment(customerId: string, label: string, createdAt: string) {
    const room = await prisma.chatRoom.create({
      data: { channel: 'FACEBOOK', externalUserId: `journey-order-${label}-${stamp}`, customerId, createdAt: at('2026-09-01T01:00:00.000Z') },
    });
    roomIds.push(room.id);
    const todo = await prisma.todo.create({
      data: { title: 'นัดดูเครื่อง', createdById: userId, roomId: room.id, dueDate: at('2026-09-20T03:00:00.000Z'), createdAt: at(createdAt) },
    });
    todoIds.push(todo.id);
  }
  /** ใบตรวจเครดิต = หลักฐานขั้น 3 ตรวจเครดิต (ตั้ง path INSTALLMENT) */
  async function creditCheck(customerId: string, createdAt: string) {
    await prisma.creditCheck.create({ data: { customerId, createdAt: at(createdAt) } });
  }
  async function cashSale(customerId: string, createdAt: string) {
    const row = await prisma.sale.create({
      data: {
        saleNumber: `JSO-${tail}-${saleIds.length}`, saleType: 'CASH', customerId, productId, branchId, salespersonId: userId,
        sellingPrice: 25000, netAmount: 25000, createdAt: at(createdAt),
      },
    });
    saleIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `journey order spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-order-${stamp}@spec.local`, password: 'x', name: 'journey order spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'journey order phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId } })).id;
  });

  afterAll(async () => {
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.todo.deleteMany({ where: { id: { in: todoIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('นัดก่อน ตรวจเครดิตทีหลัง → ขั้น นัด / จอง (INTERESTED) · stage_entered_at = เวลานัด · path INSTALLMENT', async () => {
    const c = await customer('appoint-first');
    await appointment(c.id, 'appoint-first', '2026-09-02T00:00:00.000Z');
    await creditCheck(c.id, '2026-09-03T00:00:00.000Z');
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect({ stage: s.stage, path: s.path, interestedAt: iso(s.interestedAt), creditAt: iso(s.creditAt), stageEnteredAt: iso(s.stageEnteredAt) }).toEqual({
      stage: 'INTERESTED',
      path: 'INSTALLMENT',
      interestedAt: '2026-09-02T00:00:00.000Z',
      creditAt: '2026-09-03T00:00:00.000Z',
      stageEnteredAt: '2026-09-02T00:00:00.000Z',
    });
  });

  it('ตรวจเครดิตก่อน นัดทีหลัง → ขั้น นัด / จอง · stage_entered_at = เวลานัด (ไม่ใช่เวลาตรวจเครดิตที่เก่ากว่า)', async () => {
    const c = await customer('credit-first');
    await creditCheck(c.id, '2026-09-02T00:00:00.000Z');
    await appointment(c.id, 'credit-first', '2026-09-05T00:00:00.000Z');
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect({ stage: s.stage, path: s.path, creditAt: iso(s.creditAt), stageEnteredAt: iso(s.stageEnteredAt) }).toEqual({
      stage: 'INTERESTED',
      path: 'INSTALLMENT',
      creditAt: '2026-09-02T00:00:00.000Z',
      stageEnteredAt: '2026-09-05T00:00:00.000Z',
    });
  });

  it('ตรวจเครดิตอย่างเดียว → ขั้น ตรวจเครดิต (CREDIT) · นัดที่ตามมาทีหลัง → ขยับขึ้น นัด / จอง ในการคำนวณครั้งถัดไป', async () => {
    const c = await customer('credit-only');
    await creditCheck(c.id, '2026-09-03T00:00:00.000Z');
    await service.recompute([c.id]);
    const credit = await stateOf(c.id);
    expect({ stage: credit.stage, path: credit.path, interestedAt: iso(credit.interestedAt), stageEnteredAt: iso(credit.stageEnteredAt) }).toEqual({
      stage: 'CREDIT',
      path: 'INSTALLMENT',
      interestedAt: null,
      stageEnteredAt: '2026-09-03T00:00:00.000Z',
    });

    await appointment(c.id, 'credit-only', '2026-09-06T00:00:00.000Z');
    await service.recompute([c.id]);
    const moved = await stateOf(c.id);
    expect({ stage: moved.stage, stageEnteredAt: iso(moved.stageEnteredAt) }).toEqual({ stage: 'INTERESTED', stageEnteredAt: '2026-09-06T00:00:00.000Z' });
  });

  it('นัดอย่างเดียว → ขั้น นัด / จอง · ไม่มีเวลาตรวจเครดิต (แถบวาดขั้น 3 เป็น "ข้าม") · path UNKNOWN', async () => {
    const c = await customer('appoint-only');
    await appointment(c.id, 'appoint-only', '2026-09-02T00:00:00.000Z');
    await service.recompute([c.id]);
    const s = await stateOf(c.id);
    expect({ stage: s.stage, path: s.path, creditAt: iso(s.creditAt), stageEnteredAt: iso(s.stageEnteredAt) }).toEqual({
      stage: 'INTERESTED',
      path: 'UNKNOWN',
      creditAt: null,
      stageEnteredAt: '2026-09-02T00:00:00.000Z',
    });
  });

  it('ยกเลิกใบขายใบเดียว → ถอยไป นัด / จอง ทั้งทาง withLiveBought (แคชยังเป็น PURCHASED) และทาง SQL', async () => {
    const c = await customer('unbuy');
    await appointment(c.id, 'unbuy', '2026-09-02T00:00:00.000Z');
    await creditCheck(c.id, '2026-09-03T00:00:00.000Z');
    const sale = await cashSale(c.id, '2026-09-04T00:00:00.000Z');
    await service.recompute([c.id]);
    const bought = await stateOf(c.id);
    expect({ stage: bought.stage, path: bought.path, firstPurchaseAt: iso(bought.firstPurchaseAt) }).toEqual({
      stage: 'PURCHASED',
      path: 'CASH',
      firstPurchaseAt: '2026-09-04T00:00:00.000Z',
    });

    await prisma.sale.update({ where: { id: sale.id }, data: { deletedAt: at('2026-09-05T00:00:00.000Z') } });
    const live = withLiveBought(bought, false, at('2026-09-06T00:00:00.000Z'));
    expect({ stage: live.stage, stageEnteredAt: iso(live.stageEnteredAt), firstPurchaseAt: live.firstPurchaseAt }).toEqual({
      stage: 'INTERESTED',
      stageEnteredAt: '2026-09-02T00:00:00.000Z',
      firstPurchaseAt: null,
    });

    await service.recompute([c.id]);
    const back = await stateOf(c.id);
    expect({
      stage: back.stage, path: back.path, stageEnteredAt: iso(back.stageEnteredAt), firstPurchaseAt: iso(back.firstPurchaseAt), firstPurchaseKind: back.firstPurchaseKind,
    }).toEqual({ stage: 'INTERESTED', path: 'INSTALLMENT', stageEnteredAt: '2026-09-02T00:00:00.000Z', firstPurchaseAt: null, firstPurchaseKind: null });
  });
});
