import { Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { STAGE_LABELS } from '@installment/shared';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';

/** summary กับ Postgres จริง: ตรวจ BOUGHT สด · กติกา 15 นาที · redirect/404 · PDPA · ผู้ใช้ของ spec ถูกปล่อยไว้เพราะ audit_logs ลบไม่ได้ */
describe('JourneySummaryService.summary (real DB)', () => {
  const prisma = new PrismaClient();
  const state = new JourneyStateService(prisma as any);
  const service = new JourneySummaryService(prisma as any, state);
  const actor = { id: 'u1', role: 'SALES' };
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const customerIds: string[] = [];
  const saleIds: string[] = [];
  const contractIds: string[] = [];
  let branchId: string;
  let productId: string;
  let userId: string;

  async function walkIn(label: string, phone: string) {
    const row = await prisma.customer.create({ data: { name: `summary ${label}`, phone } });
    customerIds.push(row.id);
    return row;
  }
  async function cashSale(customerId: string) {
    const row = await prisma.sale.create({
      data: { saleNumber: `JSS-${tail}-${saleIds.length}`, saleType: 'CASH', customerId, productId, branchId, salespersonId: userId, sellingPrice: 9900, netAmount: 9900 },
    });
    saleIds.push(row.id);
  }
  const ageState = (customerId: string) =>
    prisma.customerJourneyState.update({ where: { customerId }, data: { computedAt: new Date(Date.now() - 60 * 60_000) } });

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `summary spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-summary-${stamp}@spec.local`, password: 'x', name: 'summary spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'summary phone', brand: 'Apple', model: 'iPhone 13', category: 'PHONE_USED', costPrice: 8000, branchId } })).id;
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('ไม่มีแคช → คำนวณในคำขอ · แถบ 5 ขั้น · ไม่มีเบอร์ในคำตอบ · เรียกซ้ำภายใน 15 นาทีไม่คำนวณใหม่', async () => {
    const phone = `085${tail}`;
    const c = await walkIn('fresh', phone);
    const spy = jest.spyOn(state, 'recompute');
    const first = await service.summary(c.id, actor);
    expect(spy).toHaveBeenCalledWith([c.id]);
    expect(first).toMatchObject({ stage: 'IDENTIFIED', stageLabel: STAGE_LABELS.IDENTIFIED, firstSourceLabel: 'หน้าร้าน', creditRejected: false, postSaleBadges: [] });
    expect(JSON.stringify(first)).not.toContain(phone);
    spy.mockClear();
    await service.summary(c.id, actor);
    expect(spy).not.toHaveBeenCalled();
  });

  it('แคชยังไม่ซื้อ แต่ BOUGHT_WHERE สดเป็นจริง → คำนวณใหม่ทันทีแม้แคชยังไม่ถึง 15 นาที', async () => {
    const c = await walkIn('bought', `086${tail}`);
    await service.summary(c.id, actor);
    await cashSale(c.id);
    const res = await service.summary(c.id, actor);
    expect(res).toMatchObject({ stage: 'PURCHASED', path: 'CASH', silentDays: null });
    if (!('steps' in res)) throw new Error('คาดว่าเป็น JourneySummary');
    expect(res.steps.find((s) => s.stage === 'CREDIT')?.state).toBe('skipped');
  });

  it('แคชเก่ากว่า 15 นาที: มีความเคลื่อนไหวใหม่ → คำนวณใหม่ · ไม่มีอะไรขยับ → ใช้แคชเดิม', async () => {
    const moved = await walkIn('stale-moved', `087${tail}`);
    await service.summary(moved.id, actor);
    await ageState(moved.id);
    await prisma.creditCheck.create({ data: { customerId: moved.id } });
    expect(await service.summary(moved.id, actor)).toMatchObject({ stage: 'CREDIT', path: 'INSTALLMENT' });

    const idle = await walkIn('stale-idle', `088${tail}`);
    await service.summary(idle.id, actor);
    await ageState(idle.id);
    await prisma.$executeRawUnsafe('UPDATE customers SET updated_at = $1::timestamp WHERE id = $2', new Date(Date.now() - 2 * 60 * 60_000).toISOString(), idle.id);
    const spy = jest.spyOn(state, 'recompute');
    await service.summary(idle.id, actor);
    expect(spy).not.toHaveBeenCalled();
  });

  it('recompute ล้ม → ยังคืน PURCHASED สดจาก BOUGHT_WHERE บนแคชเก่า', async () => {
    const c = await walkIn('recompute-fails', `089${tail}`);
    await service.summary(c.id, actor);
    await cashSale(c.id);
    jest.spyOn(state, 'recompute').mockRejectedValueOnce(new Error('db down'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(await service.summary(c.id, actor)).toMatchObject({ stage: 'PURCHASED' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect((await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId: c.id } })).stage).toBe('IDENTIFIED');
  });

  it('placeholder ที่รวมแล้ว → redirectToCustomerId · ลบด้วยเหตุอื่น/ไม่มีอยู่ → 404', async () => {
    const target = await walkIn('target', `080${tail}`);
    const merged = await prisma.customer.create({ data: { name: 'summary merged', phone: null, acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date(), mergedIntoId: target.id } });
    const removed = await prisma.customer.create({ data: { name: 'summary removed', phone: null, deletedAt: new Date() } });
    customerIds.push(merged.id, removed.id);
    expect(await service.summary(merged.id, actor)).toEqual({ redirectToCustomerId: target.id });
    await expect(service.summary(removed.id, actor)).rejects.toThrow(NotFoundException);
    await expect(service.summary('00000000-0000-0000-0000-000000000000', actor)).rejects.toThrow('ไม่พบลูกค้า');
  });

  it('ผู้จัดการตีตกเครดิตล่าสุด → creditRejected · นัดจากบันทึกมือ → evidence MANUAL', async () => {
    const c = await walkIn('rejected', `090${tail}`);
    const check = await prisma.creditCheck.create({ data: { customerId: c.id } });
    await prisma.auditLog.create({ data: { userId, action: 'CREDIT_CHECK_OVERRIDE', entity: 'credit_check', entityId: check.id, newValue: { status: 'REJECTED' } } });
    await prisma.customerJourneyEntry.create({
      data: { customerId: c.id, originCustomerId: c.id, origin: 'MANUAL', kind: 'TOUCHPOINT', channel: 'FB_APP', outcome: 'APPOINTED', occurredAt: new Date(Date.now() - 86_400_000), actorType: 'STAFF', actorUserId: userId },
    });
    const res = await service.summary(c.id, actor);
    expect(res).toMatchObject({ stage: 'CREDIT', creditRejected: true });
    if (!('steps' in res)) throw new Error('คาดว่าเป็น JourneySummary');
    expect(res.steps.find((s) => s.stage === 'INTERESTED')).toMatchObject({ state: 'done', evidence: 'MANUAL' });
  });

  it('ซื้อแล้ว: ป้ายหลังการขาย = สถานะสัญญาล่าสุด + ซื้อซ้ำ', async () => {
    const c = await walkIn('post-sale', `091${tail}`);
    await cashSale(c.id);
    const k = await prisma.contract.create({
      data: {
        contractNumber: `JSC-${tail}`, customerId: c.id, productId, branchId, salespersonId: userId, planType: 'STORE_WITH_INTEREST',
        sellingPrice: 25000, downPayment: 5000, interestRate: 0.02, totalMonths: 10, interestTotal: 4000, financedAmount: 20000, monthlyPayment: 2400, status: 'OVERDUE',
      },
    });
    contractIds.push(k.id);
    expect(await service.summary(c.id, actor)).toMatchObject({ stage: 'PURCHASED', postSaleBadges: ['ค้างชำระ', 'ซื้อซ้ำ'] });
  });
});
