import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { JourneyStateService } from '../src/modules/customer-journey/journey-state.service';
import { JourneySummaryService } from '../src/modules/customer-journey/journey-summary.service';
import { ChatSalesDispositionService } from '../src/modules/customer-journey/chat-sales-disposition.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import type { ChatWorkActor } from '@installment/shared';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use isolated chat operations harness');
describe('Manual sales disposition preserves original journey evidence', () => {
  const db = new PrismaService();
  const states = new JourneyStateService(db);
  const summaries = new JourneySummaryService(db, states);
  const service = new ChatSalesDispositionService(db, states, new ChatWorkAccessService(db));
  let actor: ChatWorkActor;
  let branchId: string;
  const scope = { company: 'SHOP' as const };
  beforeAll(async () => {
    await db.$connect();
    branchId = (await db.branch.create({ data: { name: 'Disposition' } })).id;
    actor = await db.user.create({
      data: {
        name: 'Disposition staff',
        email: `${randomUUID()}@test.invalid`,
        password: 'unused',
        role: 'SALES',
        branchId,
        accessibleCompanies: ['SHOP'],
      },
    });
    await db.systemConfig.upsert({
      where: { key: 'chat_follow_up_enabled' },
      create: { key: 'chat_follow_up_enabled', value: 'true' },
      update: { value: 'true', deletedAt: null },
    });
  });
  afterAll(() => db.$disconnect());
  const fixture = async () => {
    const customer = await db.customer.create({ data: { name: 'Synthetic disposition' } });
    const room = await db.chatRoom.create({
      data: { channel: 'FACEBOOK', customerId: customer.id, assignedToId: actor.id },
    });
    return { customer, room };
  };
  const mark = (roomId: string) => ({
    roomId,
    action: 'MARK_LOST' as const,
    reason: 'BOUGHT_ELSEWHERE',
    clientRequestId: randomUUID(),
  });
  it('deduplicates a manual lost event and reopening appends history without changing the evidence stage', async () => {
    const { customer, room } = await fixture();
    const task = await db.todo.create({
      data: { roomId: room.id, title: 'นัด', createdById: actor.id, dueDate: new Date() },
    });
    const request = mark(room.id);
    const [a, b] = await Promise.all([
      service.record(request, actor, scope),
      service.record(request, actor, scope),
    ]);
    expect(a.id).toBe(b.id);
    expect(await db.customerJourneyEntry.count({ where: { customerId: customer.id } })).toBe(1);
    const lost = await summaries.summary(customer.id, actor);
    expect(lost).toMatchObject({ stage: 'INTERESTED', lost: { reason: 'BOUGHT_ELSEWHERE' } });
    await service.record(
      { roomId: room.id, action: 'REOPEN', clientRequestId: randomUUID() },
      actor,
      scope,
    );
    expect(await summaries.summary(customer.id, actor)).toMatchObject({
      stage: 'INTERESTED',
      lost: null,
    });
    const events = await db.customerJourneyEntry.findMany({ where: { customerId: customer.id } });
    expect(events).toHaveLength(2);
    expect(
      events.every((e) => e.origin === 'MANUAL' && e.actorType === 'STAFF' && e.dedupeKey === null),
    ).toBe(true);
    expect((await db.todo.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('TODO');
  });
  it('rejects missing reason, foreign room/company and unlinked room without history', async () => {
    const { room } = await fixture();
    await expect(
      service.record({ ...mark(room.id), reason: undefined }, actor, scope),
    ).rejects.toThrow();
    await expect(service.record(mark(room.id), actor, { company: 'FINANCE' })).rejects.toThrow();
    const other = await db.chatRoom.create({ data: { channel: 'FACEBOOK' } });
    await expect(service.record(mark(other.id), actor, scope)).rejects.toThrow();
    expect(await db.customerJourneyEntry.count({ where: { roomId: room.id } })).toBe(0);
  });
  it('uses canonical customer after merge and prevents reusing a token for a different room or action', async () => {
    const { customer, room } = await fixture();
    const canonical = await db.customer.create({ data: { name: 'Canonical disposition' } });
    await db.customer.update({
      where: { id: customer.id },
      data: { deletedAt: new Date(), mergedIntoId: canonical.id },
    });
    const input = mark(room.id);
    const event = await service.record(input, actor, scope);
    expect(event.customerId).toBe(canonical.id);
    await expect(service.record({ ...input, action: 'REOPEN' }, actor, scope)).rejects.toThrow();
    const other = await fixture();
    await expect(
      service.record({ ...input, roomId: other.room.id }, actor, scope),
    ).rejects.toThrow();
  });
  it('does not let an inaccessible purchase block a scoped lost decision', async () => {
    const { customer, room } = await fixture();
    const hiddenBranch = await db.branch.create({ data: { name: 'Hidden purchase branch' } });
    const product = await db.product.create({
      data: {
        name: 'Hidden phone',
        brand: 'Apple',
        model: 'Phone',
        category: 'PHONE_USED',
        branchId: hiddenBranch.id,
        costPrice: 5000,
      },
    });
    await db.sale.create({
      data: {
        saleNumber: `hidden-loss-${randomUUID()}`,
        customerId: customer.id,
        productId: product.id,
        branchId: hiddenBranch.id,
        salespersonId: actor.id,
        saleType: 'CASH',
        sellingPrice: 9900,
        netAmount: 9900,
      },
    });
    await expect(service.record(mark(room.id), actor, scope)).resolves.toMatchObject({
      kind: 'MARKED_LOST',
    });
  });
  it('rejects MARK_LOST when live purchase exists even with a stale cache; voiding purchase restores eligibility', async () => {
    const { customer, room } = await fixture();
    await states.recompute([customer.id]);
    const product = await db.product.create({
      data: {
        name: 'Phone',
        brand: 'Apple',
        model: 'Phone',
        category: 'PHONE_USED',
        branchId,
        costPrice: 5000,
      },
    });
    const sale = await db.sale.create({
      data: {
        saleNumber: `disposition-${randomUUID()}`,
        customerId: customer.id,
        productId: product.id,
        branchId,
        salespersonId: actor.id,
        saleType: 'CASH',
        sellingPrice: 9900,
        netAmount: 9900,
      },
    });
    await expect(service.record(mark(room.id), actor, scope)).rejects.toThrow('ซื้อแล้ว');
    expect(await summaries.summary(customer.id, actor)).toMatchObject({
      stage: 'PURCHASED',
      path: 'CASH',
    });
    await db.sale.update({ where: { id: sale.id }, data: { deletedAt: new Date() } });
    await service.record(mark(room.id), actor, scope);
    expect(await summaries.summary(customer.id, actor)).toMatchObject({
      lost: { reason: 'BOUGHT_ELSEWHERE' },
    });
  });
});
