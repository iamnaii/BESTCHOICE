import { randomUUID } from 'node:crypto';
import type { ChatWorkActor } from '@installment/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatSalesContextService } from '../src/modules/staff-chat/services/chat-sales-context.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { JourneySummaryService } from '../src/modules/customer-journey/journey-summary.service';
import { JourneyStateService } from '../src/modules/customer-journey/journey-state.service';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use isolated chat operations harness');
describe('Sales context composes the original live Journey summary', () => {
  const db = new PrismaService();
  const summaries = new JourneySummaryService(db, new JourneyStateService(db));
  const service = new ChatSalesContextService(db, new ChatWorkAccessService(db), summaries);
  let actor: ChatWorkActor;
  let branchId: string;
  let otherBranchId: string;
  let productId: string;
  const scope = { company: 'SHOP' as const };
  beforeAll(async () => {
    await db.$connect();
    branchId = (await db.branch.create({ data: { name: 'Sales context branch' } })).id;
    otherBranchId = (await db.branch.create({ data: { name: 'Other context branch' } })).id;
    actor = await db.user.create({
      data: {
        name: 'Context actor',
        email: `${randomUUID()}@test.invalid`,
        password: 'unused',
        role: 'SALES',
        branchId,
        accessibleCompanies: ['SHOP'],
      },
    });
    productId = (
      await db.product.create({
        data: {
          name: 'Context phone',
          brand: 'Apple',
          model: 'iPhone 15',
          category: 'PHONE_USED',
          branchId,
          costPrice: 5000,
        },
      })
    ).id;
  });
  afterAll(async () => db.$disconnect());
  const room = (customerId?: string) =>
    db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: actor.id, customerId } });
  const customer = () =>
    db.customer.create({ data: { name: 'Synthetic context customer', phone: null } });
  const sale = (customerId: string, saleType: 'CASH' | 'INSTALLMENT' = 'CASH', branch = branchId) =>
    db.sale.create({
      data: {
        saleNumber: `context-${randomUUID()}`,
        customerId,
        productId,
        branchId: branch,
        salespersonId: actor.id,
        saleType,
        sellingPrice: 9900,
        netAmount: 9900,
      },
    });
  it('has no invented journey for an unlinked room and chooses nearest active appointment', async () => {
    const r = await room();
    const next = await db.todo.create({
      data: {
        title: 'โทรติดตาม',
        roomId: r.id,
        createdById: actor.id,
        dueDate: new Date('2026-10-06T08:00:00Z'),
      },
    });
    await db.todo.create({
      data: {
        title: 'เสร็จแล้ว',
        roomId: r.id,
        createdById: actor.id,
        status: 'DONE',
        dueDate: new Date('2026-10-06T07:00:00Z'),
      },
    });
    expect(await service.get(r.id, actor, scope)).toMatchObject({
      customerId: null,
      journey: null,
      nextAction: { todoId: next.id },
      evidenceLinks: [{ kind: 'APPOINTMENT', id: next.id }],
    });
  });
  it('pending installment is not a purchase; cash skips credit; void sale invalidates fresh PURCHASED cache', async () => {
    const c = await customer();
    const r = await room(c.id);
    await sale(c.id, 'INSTALLMENT');
    expect((await service.get(r.id, actor, scope)).journey?.stage).not.toBe('PURCHASED');
    const cash = await sale(c.id);
    const bought = await service.get(r.id, actor, scope);
    expect(bought.journey).toMatchObject({ stage: 'PURCHASED', path: 'CASH' });
    expect(bought.journey?.steps.find((s) => s.stage === 'CREDIT')?.state).toBe('not_needed');
    expect(bought.evidenceLinks).toContainEqual(
      expect.objectContaining({ kind: 'PURCHASE', id: cash.id }),
    );
    await db.sale.update({ where: { id: cash.id }, data: { deletedAt: new Date() } });
    expect((await service.get(r.id, actor, scope)).journey?.stage).not.toBe('PURCHASED');
  });
  it('follows merged customer references without losing room-specific appointments', async () => {
    const canonical = await customer();
    const old = await customer();
    await db.customer.update({
      where: { id: old.id },
      data: { deletedAt: new Date(), mergedIntoId: canonical.id },
    });
    const r = await room(old.id);
    const todo = await db.todo.create({
      data: { title: 'นัดห้องเดิม', roomId: r.id, createdById: actor.id },
    });
    expect(await service.get(r.id, actor, scope)).toMatchObject({
      customerId: canonical.id,
      nextAction: { todoId: todo.id },
    });
  });
  it('does not disclose cross-branch purchase IDs or credit analyses from another room/company', async () => {
    const c = await customer();
    const r = await room(c.id);
    const hiddenSale = await sale(c.id, 'CASH', otherBranchId);
    const finance = await db.chatRoom.create({
      data: { channel: 'LINE_FINANCE', customerId: c.id },
    });
    const hiddenCredit = await db.roomCreditAnalysis.create({
      data: { roomId: finance.id, status: 'COMPLETED', fileIds: [] },
    });
    const result = JSON.stringify(await service.get(r.id, actor, scope));
    expect(result).not.toContain(hiddenSale.id);
    expect(result).not.toContain(hiddenCredit.id);
    await expect(service.get(finance.id, actor, scope)).rejects.toThrow();
  });
  it('does not disclose global journey, loss, finance or repair badges through a SHOP summary', async () => {
    const c = await customer();
    const r = await room(c.id);
    await db.chatMessage.create({ data: { roomId: r.id, role: 'CUSTOMER', text: 'hello' } });
    const foreign = await db.chatRoom.create({
      data: { channel: 'LINE_FINANCE', customerId: c.id },
    });
    await db.customerJourneyEntry.create({
      data: {
        customerId: c.id,
        roomId: foreign.id,
        kind: 'MARKED_LOST',
        lostReason: 'OTHER',
        occurredAt: new Date(),
        actorUserId: actor.id,
        actorType: 'STAFF',
        origin: 'MANUAL',
        originCustomerId: c.id,
      },
    });
    await sale(c.id, 'CASH', otherBranchId);
    await db.contract.create({
      data: {
        contractNumber: `hidden-${randomUUID()}`,
        customerId: c.id,
        productId,
        branchId,
        salespersonId: actor.id,
        planType: 'STORE_DIRECT',
        status: 'OVERDUE',
        sellingPrice: 10000,
        downPayment: 2000,
        financedAmount: 8000,
        interestRate: 0.02,
        interestTotal: 1000,
        totalMonths: 10,
        monthlyPayment: 900,
      },
    });
    await db.repairTicket.create({
      data: {
        ticketNumber: `hidden-${randomUUID()}`,
        customerId: c.id,
        branchId: otherBranchId,
        createdById: actor.id,
        defectDescription: 'private',
      },
    });
    const result = await service.get(r.id, actor, scope);
    expect(result.journey).toMatchObject({
      stage: 'CONTACTED',
      lost: null,
      firstAd: null,
      postSaleBadges: [],
    });
    const cash = await sale(c.id);
    const bought = await service.get(r.id, actor, scope);
    expect(bought.journey).toMatchObject({ stage: 'PURCHASED', path: 'CASH', postSaleBadges: [] });
    expect(bought.evidenceLinks).toContainEqual(expect.objectContaining({ id: cash.id }));
  });
  it('does not return the old customer context when the room is relinked during the read', async () => {
    const a = await customer();
    const b = await customer();
    const r = await room(a.id);
    const original = summaries.summary.bind(summaries);
    const spy = jest
      .spyOn(summaries, 'summary')
      .mockImplementationOnce(async (id, user, selectedScope) => {
        const result = await original(id, user, selectedScope);
        await db.chatRoom.update({ where: { id: r.id }, data: { customerId: b.id } });
        return result;
      });
    try {
      await expect(service.get(r.id, actor, scope)).rejects.toThrow('เปลี่ยนไป');
    } finally {
      spy.mockRestore();
    }
  });
  it('opens the exact credit evidence and rejects an ID from another room', async () => {
    const r = await room();
    const other = await room();
    const first = await db.roomCreditAnalysis.create({
      data: { roomId: r.id, status: 'COMPLETED', fileIds: [], result: { monthlyIncome: 18000 } },
    });
    await db.roomCreditAnalysis.create({
      data: { roomId: r.id, status: 'COMPLETED', fileIds: [], result: { monthlyIncome: 22000 } },
    });
    expect(await service.creditEvidence(r.id, first.id, actor, scope)).toMatchObject({
      id: first.id,
      result: { monthlyIncome: 18000 },
    });
    await expect(service.creditEvidence(other.id, first.id, actor, scope)).rejects.toThrow();
  });
  it('bounds malformed customer redirect loops instead of hanging', async () => {
    const a = await customer();
    const b = await customer();
    await db.customer.update({
      where: { id: a.id },
      data: { deletedAt: new Date(), mergedIntoId: b.id },
    });
    await db.customer.update({
      where: { id: b.id },
      data: { deletedAt: new Date(), mergedIntoId: a.id },
    });
    const r = await room(a.id);
    await expect(service.get(r.id, actor, scope)).rejects.toThrow('ข้อมูลการรวมลูกค้า');
  });
});
