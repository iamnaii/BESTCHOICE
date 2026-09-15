import { Prisma, PrismaClient } from '@prisma/client';
import { JourneyStateService } from './journey-state.service';
import { journeyDedupeKey } from './journey-data-schemas';

/**
 * ตัวตรวจความเคลื่อนไหว (summary 15 นาที · cron 48 ชม.) และด่าน entry-guard กับ Postgres จริง
 * audit_logs ลบไม่ได้ (trigger audit_logs_no_delete) ⇒ ผู้ใช้ของ spec ถูกปล่อยไว้
 */
describe('JourneyStateService — ความเคลื่อนไหว + entry-guard (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new JourneyStateService(prisma as any);
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (value: string) => new Date(value);
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const saleIds: string[] = [];
  const contractIds: string[] = [];
  let branchId: string;
  let productId: string;
  let userId: string;

  async function customer(data: Prisma.CustomerUncheckedCreateInput) {
    const row = await prisma.customer.create({ data });
    customerIds.push(row.id);
    return row;
  }
  async function contract(customerId: string, status: 'ACTIVE' | 'OVERDUE', createdAt: string) {
    const row = await prisma.contract.create({
      data: {
        contractNumber: `JG-${tail}-${contractIds.length}`, customerId, productId, branchId, salespersonId: userId, planType: 'STORE_WITH_INTEREST',
        sellingPrice: 25000, downPayment: 5000, interestRate: 0.02, totalMonths: 10, interestTotal: 4000, financedAmount: 20000, monthlyPayment: 2400,
        status, createdAt: at(createdAt),
      },
    });
    contractIds.push(row.id);
    return row;
  }
  async function installmentSale(customerId: string, createdAt: string, contractId: string) {
    const row = await prisma.sale.create({
      data: { saleNumber: `JG-${tail}-${saleIds.length}`, saleType: 'INSTALLMENT', customerId, productId, branchId, salespersonId: userId, sellingPrice: 25000, netAmount: 25000, contractId, createdAt: at(createdAt) },
    });
    saleIds.push(row.id);
  }

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `journey activity spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-activity-${stamp}@spec.local`, password: 'x', name: 'journey activity spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'journey activity phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId } })).id;
  });

  afterAll(async () => {
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.$disconnect();
  });

  it('placeholder ที่รวมแล้วขยับ → activeCustomerIdsSince ชี้กลับคนจริง · hasActivitySince ของครอบครัวตามเวลา', async () => {
    const target = await customer({ name: 'journey activity target', phone: `084${tail}` });
    const placeholder = await customer({
      name: 'journey activity placeholder', phone: null, acquisitionSource: 'CHAT_LINE_SHOP', deletedAt: new Date(), mergedIntoId: target.id,
    });
    const room = await prisma.chatRoom.create({ data: { channel: 'LINE_SHOP', externalUserId: `journey-activity-${stamp}`, customerId: target.id } });
    roomIds.push(room.id);
    await prisma.auditLog.create({ data: { userId, action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: placeholder.id } });

    const active = await service.activeCustomerIdsSince(new Date(Date.now() - 10 * 60_000));
    expect(active).toContain(target.id);
    expect(active).not.toContain(placeholder.id);
    expect(await service.hasActivitySince([target.id, placeholder.id], new Date(Date.now() - 60_000))).toBe(true);
    expect(await service.hasActivitySince([target.id, placeholder.id], new Date(Date.now() + 60_000))).toBe(false);
  });

  it('entry-guard: ใบขายผ่อนในช่วงเวลา → คืนเฉพาะสัญญาที่ยังไม่มี entry CONTRACT_ACTIVATED', async () => {
    const c = await customer({ name: 'journey guard installment', phone: `083${tail}`, createdAt: at('2031-01-01T00:00:00.000Z') });
    const k1 = await contract(c.id, 'ACTIVE', '2031-01-01T01:00:00.000Z');
    const k2 = await contract(c.id, 'OVERDUE', '2031-01-01T02:00:00.000Z');
    await installmentSale(c.id, '2031-01-01T05:00:00.000Z', k1.id);
    await installmentSale(c.id, '2031-01-01T06:00:00.000Z', k2.id);
    await prisma.customerJourneyEntry.create({
      data: {
        customerId: c.id, originCustomerId: c.id, origin: 'SYSTEM', kind: 'CONTRACT_ACTIVATED', occurredAt: at('2031-01-01T04:59:00.000Z'),
        actorType: 'STAFF', refType: 'contract', refId: k1.id, dedupeKey: journeyDedupeKey('CONTRACT_ACTIVATED', k1.id),
      },
    });

    expect(await service.contractsMissingActivationEntry({ gte: at('2031-01-01T00:00:00.000Z'), lt: at('2031-01-02T00:00:00.000Z') })).toEqual([k2.id]);
    expect(await service.contractsMissingActivationEntry({ gte: at('2031-01-02T00:00:00.000Z'), lt: at('2031-01-03T00:00:00.000Z') })).toEqual([]);
  });
});
