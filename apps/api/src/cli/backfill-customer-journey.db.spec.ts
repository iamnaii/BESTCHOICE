import { ChatChannel, PrismaClient } from '@prisma/client';
import { JourneyStateService } from '../modules/customer-journey/journey-state.service';
import { backfillExitCode, checkPurchasedParity, planJourneyBackfill, runJourneyBackfill } from './backfill-customer-journey.cli';

/**
 * backfill:customer-journey บน Postgres จริง (ฐานทดสอบตาม Global Constraints เท่านั้น)
 * ข้อมูลชุดเล็ก: ผู้สนใจจากแชทไม่มีเบอร์ · walk-in มีเบอร์ยังไม่ซื้อ · คนซื้อเงินสด
 * + ห้องแชทมีเจ้าของ 1 / ไม่มีเจ้าของ 1 + placeholder ที่รวมแล้ว 1 + placeholder จากแชทที่ลบแต่ไม่มี merged_into_id 1
 * ตัวเลขแผนตรวจเป็นส่วนต่าง (after − before) กันแถวค้างจาก spec อื่นในฐานเดียวกัน
 * ข้อความแชทในชุดทดสอบไม่มีเนื้อหา — CLI ไม่อ่านข้อความ (PDPA)
 */
describe('backfill-customer-journey (real DB)', () => {
  const prisma = new PrismaClient();
  const stateService = new JourneyStateService(prisma as never);
  const stamp = Date.now();
  let seq = 0;
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const saleIds: string[] = [];
  const productIds: string[] = [];
  const userIds: string[] = [];
  const branchIds: string[] = [];

  afterEach(async () => {
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    for (const list of [customerIds, roomIds, saleIds, productIds, userIds, branchIds]) list.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedDataset() {
    seq += 1;
    const tag = `${stamp}-${seq}`;
    const digits = `${String(stamp).slice(-7)}${seq}`;

    const branch = await prisma.branch.create({ data: { name: `journey-backfill-${tag}` } });
    branchIds.push(branch.id);
    const salesperson = await prisma.user.create({
      data: { email: `journey-backfill-${tag}@test.local`, password: 'x', name: 'journey backfill sales', role: 'SALES' },
    });
    userIds.push(salesperson.id);

    const prospect = await prisma.customer.create({
      data: { name: 'journey backfill prospect', phone: null, acquisitionSource: 'CHAT_FACEBOOK', createdAt: new Date('2026-05-01T03:00:00.000Z') },
    });
    const walkIn = await prisma.customer.create({
      data: { name: 'journey backfill walk-in', phone: `08${digits}`, createdAt: new Date('2026-05-02T03:00:00.000Z') },
    });
    const buyer = await prisma.customer.create({
      data: { name: 'journey backfill buyer', phone: `09${digits}`, createdAt: new Date('2026-05-03T03:00:00.000Z') },
    });
    const merged = await prisma.customer.create({
      data: {
        name: 'journey backfill merged placeholder',
        phone: null,
        acquisitionSource: 'CHAT_FACEBOOK',
        deletedAt: new Date('2026-05-04T03:00:00.000Z'),
        mergedIntoId: buyer.id,
      },
    });
    const orphan = await prisma.customer.create({
      data: { name: 'journey backfill orphan placeholder', phone: null, acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date('2026-05-04T03:00:00.000Z') },
    });
    customerIds.push(prospect.id, walkIn.id, buyer.id, merged.id, orphan.id);

    const linkedRoom = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-backfill-linked-${tag}`, customerId: prospect.id, createdAt: new Date('2026-05-01T03:00:00.000Z') },
    });
    const unlinkedRoom = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-backfill-unlinked-${tag}` },
    });
    roomIds.push(linkedRoom.id, unlinkedRoom.id);
    await prisma.chatMessage.create({ data: { roomId: linkedRoom.id, role: 'CUSTOMER', createdAt: new Date('2026-05-01T03:00:05.000Z') } });

    const product = await prisma.product.create({
      data: { name: 'journey backfill phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: '20000.00', branchId: branch.id },
    });
    productIds.push(product.id);
    const sale = await prisma.sale.create({
      data: {
        saleNumber: `JB-${tag}`,
        saleType: 'CASH',
        customerId: buyer.id,
        productId: product.id,
        branchId: branch.id,
        salespersonId: salesperson.id,
        sellingPrice: '25000.00',
        netAmount: '25000.00',
      },
    });
    saleIds.push(sale.id);

    return { prospect, walkIn, buyer, merged, orphan, sale };
  }

  it('แผน (dry-run) นับส่วนต่างตรงกับข้อมูลที่ใส่ และไม่เขียนแคช', async () => {
    const before = await planJourneyBackfill(prisma, stateService);
    await seedDataset();
    const after = await planJourneyBackfill(prisma, stateService);

    expect({
      customers: after.customers - before.customers,
      existingStates: after.existingStates - before.existingStates,
      boughtCustomers: after.boughtCustomers - before.boughtCustomers,
      liveRooms: after.liveRooms - before.liveRooms,
      unlinkedRooms: after.unlinkedRooms - before.unlinkedRooms,
      mergedPlaceholders: after.mergedPlaceholders - before.mergedPlaceholders,
      unmergedDeletedChatPlaceholders: after.unmergedDeletedChatPlaceholders - before.unmergedDeletedChatPlaceholders,
    }).toEqual({
      customers: 3,
      existingStates: 0,
      boughtCustomers: 1,
      liveRooms: 2,
      unlinkedRooms: 1,
      mergedPlaceholders: 1,
      unmergedDeletedChatPlaceholders: 1,
    });
  });

  it('batchSize=1 เดินครบด้วย keyset → คนที่ยังไม่ถูกลบมีแคชทุกคน · ขั้นตามกติกา · parity ตรง → exit 0 · รันซ้ำไม่เพิ่มแถว', async () => {
    const { prospect, walkIn, buyer } = await seedDataset();
    const plan = await planJourneyBackfill(prisma, stateService);

    const result = await runJourneyBackfill(prisma, stateService, { batchSize: 1, log: jest.fn() });

    expect(result).toEqual({ processed: plan.customers, batches: plan.customers, failedBatches: 0, failedCustomers: 0 });
    const states = await prisma.customerJourneyState.findMany({
      where: { customerId: { in: customerIds } },
      select: { customerId: true, stage: true },
    });
    expect(Object.fromEntries(states.map((s) => [s.customerId, s.stage]))).toEqual({
      [prospect.id]: 'CONTACTED',
      [walkIn.id]: 'IDENTIFIED',
      [buyer.id]: 'PURCHASED',
    });
    const parity = await checkPurchasedParity(stateService);
    expect(parity.ok).toBe(true);
    expect(backfillExitCode({ plan, result, parity })).toBe(0);

    const again = await runJourneyBackfill(prisma, stateService, { batchSize: 2, log: jest.fn() });
    expect(again.failedBatches).toBe(0);
    expect(await prisma.customerJourneyState.count({ where: { customerId: { in: customerIds } } })).toBe(3);
  });

  it('ยกเลิกใบขายหลังสร้างแคชโดยยังไม่ recompute → PURCHASED มากกว่า BOUGHT_WHERE 1 → exit 2 · recompute คนนั้นแล้วกลับมาตรง', async () => {
    const { buyer, sale } = await seedDataset();
    const plan = await planJourneyBackfill(prisma, stateService);
    const result = await runJourneyBackfill(prisma, stateService, { batchSize: 50, log: jest.fn() });
    await prisma.sale.update({ where: { id: sale.id }, data: { deletedAt: new Date() } });

    const stale = await checkPurchasedParity(stateService);
    expect(stale.ok).toBe(false);
    expect(stale.purchasedStates - stale.boughtCustomers).toBe(1);
    expect(backfillExitCode({ plan, result, parity: stale })).toBe(2);

    await stateService.recompute([buyer.id]);
    expect((await checkPurchasedParity(stateService)).ok).toBe(true);
    expect((await prisma.customerJourneyState.findUniqueOrThrow({ where: { customerId: buyer.id } })).stage).not.toBe('PURCHASED');
  });

  it('recompute ล้มชุดที่มี walk-in → failedBatches=1 · keyset ขยับต่อ คนซื้อ (createdAt หลังกว่า) ยังได้แคช → exit 2', async () => {
    const { prospect, walkIn, buyer } = await seedDataset();
    const plan = await planJourneyBackfill(prisma, stateService);
    const flaky = {
      recompute: async (ids: string[]) => {
        if (ids.includes(walkIn.id)) throw new Error('boom');
        await stateService.recompute(ids);
      },
    };
    const log = jest.fn();

    const result = await runJourneyBackfill(prisma, flaky, { batchSize: 1, log });

    expect(result.processed).toBe(plan.customers);
    expect(result.failedBatches).toBe(1);
    expect(result.failedCustomers).toBe(1);
    expect(log).toHaveBeenCalledWith(`FAILED batch first=${walkIn.id} last=${walkIn.id} size=1: boom`);
    const states = await prisma.customerJourneyState.findMany({
      where: { customerId: { in: [prospect.id, walkIn.id, buyer.id] } },
      select: { customerId: true },
    });
    expect(states.map((s) => s.customerId).sort()).toEqual([prospect.id, buyer.id].sort());
    expect(backfillExitCode({ plan, result, parity: await checkPurchasedParity(stateService) })).toBe(2);
  });
});
