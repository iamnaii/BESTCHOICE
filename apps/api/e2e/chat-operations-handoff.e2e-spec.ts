import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { StaffInboxService } from '../src/modules/staff-chat/services/staff-inbox.service';
import { ChatFollowUpService } from '../src/modules/staff-chat/services/chat-follow-up.service';
import { ChatHandoffService } from '../src/modules/staff-chat/services/chat-handoff.service';
import { ChatWorkQueryService } from '../src/modules/staff-chat/services/chat-work-query.service';
import type { ChatWorkActor } from '@installment/shared';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Use isolated chat operations harness');
describe('Handoffs do not transfer sales ownership', () => {
  const db = new PrismaService(); const access = new ChatWorkAccessService(db); const inbox = new StaffInboxService(db,access);
  const followUps = new ChatFollowUpService(db,access,inbox); const service = new ChatHandoffService(db,access,followUps,inbox);
  const queue = new ChatWorkQueryService(db,access); const scope = { company: 'SHOP' as const };
  let seller: ChatWorkActor; let receiver: ChatWorkActor; let manager: ChatWorkActor; let roomId: string; let branchId: string;
  beforeAll(async () => {
    await db.$connect(); branchId = (await db.branch.create({ data: { name: 'Handoff branch' } })).id;
    [seller,receiver,manager] = await Promise.all([0,1,2].map(i => db.user.create({ data: { name: `Handoff actor ${i}`, email: `${randomUUID()}@test.invalid`, password: 'unused', role: i === 0 ? 'SALES' : 'BRANCH_MANAGER', branchId, accessibleCompanies: ['SHOP'] } })));
    roomId = (await db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: seller.id } })).id;
    for (const key of ['chat_mentions_enabled', 'in_app_notifications_enabled']) await db.systemConfig.upsert({ where: { key }, create: { key, value: 'true' }, update: { value: 'true', deletedAt: null } });
  });
  beforeEach(async () => { await db.user.update({ where: { id: receiver.id }, data: { isActive: true } }); });
  afterAll(() => db.$disconnect());
  const input = () => ({ title: 'ตรวจสต็อกให้ฝ่ายขาย', assigneeId: receiver.id, dueAt: '2026-11-01T10:00:00+07:00', clientRequestId: randomUUID(), note: 'ตรวจสีชมพู' });
  it('deduplicates create and read does not accept; accepts/completes without changing signed contract or commission owner', async () => {
    const customer = await db.customer.create({ data: { name: 'Handoff customer' } });
    const product = await db.product.create({ data: { name: 'Phone', brand: 'Apple', model: 'Phone', category: 'PHONE_USED', branchId, costPrice: 5000 } });
    const contract = await db.contract.create({ data: { contractNumber: `handoff-${randomUUID()}`, customerId: customer.id, productId: product.id, branchId, salespersonId: seller.id, planType: 'STORE_DIRECT', sellingPrice: 10000, downPayment: 2000, financedAmount: 8000, interestRate: 0.02, interestTotal: 1000, totalMonths: 10, monthlyPayment: 900 } });
    await db.signature.create({ data: { contractId: contract.id, signerType: 'CUSTOMER', signatureImage: 'synthetic-only' } });
    const commission = await db.salesCommission.create({ data: { contractId: contract.id, salespersonId: seller.id, snapshotSalespersonId: seller.id, period: '2026-10', saleAmount: 10000, commissionRate: 0.01, commissionAmount: 100 } });
    await db.chatRoom.update({ where: { id: roomId }, data: { customerId: customer.id } });
    const request = input(); const [a,b] = await Promise.all([service.create(roomId,request,seller,scope),service.create(roomId,request,seller,scope)]); expect(a.id).toBe(b.id);
    const notice = await db.staffInboxItem.findFirstOrThrow({ where: { todoId: a.id, recipientId: receiver.id } });
    await inbox.markRead(notice.id,receiver,scope); expect((await db.todo.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('TODO');
    await service.update(a.id,{ expectedRevision: 0, action: 'ACCEPT' },receiver,scope);
    const done = await service.update(a.id,{ expectedRevision: 1, action: 'COMPLETE', completionNote: 'มีสินค้าสีชมพูแล้ว' },receiver,scope);
    expect(done.status).toBe('DONE'); expect(done.revision).toBe(2);
    expect((await db.chatRoom.findUniqueOrThrow({ where: { id: roomId } })).assignedToId).toBe(seller.id);
    expect((await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).salespersonId).toBe(seller.id);
    expect(await db.salesCommission.findUnique({ where: { id: commission.id } })).toMatchObject({ salespersonId: seller.id, snapshotSalespersonId: seller.id });
    expect(await db.staffInboxItem.count({ where: { todoId: a.id, recipientId: seller.id, kind: 'HANDOFF' } })).toBe(1);
    expect(await db.todoComment.findFirst({ where: { todoId: a.id } })).toMatchObject({ userId: receiver.id, content: 'มีสินค้าสีชมพูแล้ว' });
    expect((await queue.list(receiver,{ ...scope, view: 'FOR_ME', page: 1, limit: 200 })).data.map(t => t.targetId)).not.toContain(a.id);
  });
  it('only the recipient can accept/complete and completion requires accepting first', async () => {
    const task = await service.create(roomId,input(),seller,scope);
    await expect(service.update(task.id,{ expectedRevision: 0, action: 'ACCEPT' },manager,scope)).rejects.toThrow();
    await expect(service.update(task.id,{ expectedRevision: 0, action: 'COMPLETE' },receiver,scope)).rejects.toThrow();
    const results = await Promise.allSettled([1,2].map(() => service.update(task.id,{ expectedRevision: 0, action: 'ACCEPT' },receiver,scope)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.todoWorkEvent.count({ where: { todoId: task.id } })).toBe(2);
    await expect(followUps.update(task.id,{ expectedRevision: 1, status: 'DONE' },receiver,scope)).rejects.toThrow();
    await service.update(task.id,{ expectedRevision: 1, action: 'CANCEL' },seller,scope);
    await expect(service.update(task.id,{ expectedRevision: 2, action: 'ACCEPT' },receiver,scope)).rejects.toThrow();
  });
  it('keeps orphaned work visible to a scoped manager without silently reassigning it', async () => {
    const task = await service.create(roomId,input(),seller,scope);
    await db.user.update({ where: { id: receiver.id }, data: { isActive: false } });
    const mine = await queue.list(manager,{ ...scope, view: 'FOR_ME', page: 1, limit: 200 });
    expect(mine.data.find(t => t.targetId === task.id)).toMatchObject({ orphaned: true, assigneeId: receiver.id });
    const cancelled = await service.update(task.id,{ expectedRevision: 0, action: 'CANCEL' },manager,scope);
    expect(cancelled.status).toBe('CANCELLED'); expect(cancelled.assigneeId).toBe(receiver.id);
  });
  it('rolls back completion, its comment and history if the creator notification cannot be committed', async () => {
    const task = await service.create(roomId,input(),seller,scope);
    await service.update(task.id,{ expectedRevision: 0, action: 'ACCEPT' },receiver,scope);
    await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_handoff() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'HANDOFF' THEN RAISE EXCEPTION 'synthetic completion rollback'; END IF; RETURN NEW; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_reject_handoff BEFORE INSERT ON staff_inbox_items FOR EACH ROW EXECUTE FUNCTION test_reject_handoff()`);
    try {
      await expect(service.update(task.id,{ expectedRevision: 1, action: 'COMPLETE', completionNote: 'must roll back' },receiver,scope)).rejects.toThrow();
      expect(await db.todo.findUnique({ where: { id: task.id } })).toMatchObject({ status: 'DOING', revision: 1 });
      expect(await db.todoComment.count({ where: { todoId: task.id } })).toBe(0);
      expect(await db.todoWorkEvent.count({ where: { todoId: task.id } })).toBe(2);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_reject_handoff ON staff_inbox_items');
      await db.$executeRawUnsafe('DROP FUNCTION test_reject_handoff()');
    }
  });
  it('rejects cross-company handoffs before creating tasks', async () => {
    await expect(service.create(roomId,input(),seller,{ company: 'FINANCE' })).rejects.toThrow();
    await db.user.update({ where: { id: receiver.id }, data: { accessibleCompanies: ['FINANCE'] } });
    try { await expect(service.create(roomId,input(),seller,scope)).rejects.toThrow(); }
    finally { await db.user.update({ where: { id: receiver.id }, data: { accessibleCompanies: ['SHOP'] } }); }
  });
});
