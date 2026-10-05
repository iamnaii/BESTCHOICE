import { TodosService } from '../src/modules/todos/todos.service';
import { randomUUID } from 'node:crypto';
import type { ChatWorkActor } from '@installment/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { StaffInboxService } from '../src/modules/staff-chat/services/staff-inbox.service';
import { ChatFollowUpService } from '../src/modules/staff-chat/services/chat-follow-up.service';
import { ChatWorkQueryService } from '../src/modules/staff-chat/services/chat-work-query.service';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Use isolated chat operations harness');
describe('Follow-up tasks and immutable work history', () => {
  const db = new PrismaService();
  const access = new ChatWorkAccessService(db);
  const service = new ChatFollowUpService(db, access, new StaffInboxService(db, access));
  const queue = new ChatWorkQueryService(db, access);
  const todos = new TodosService(db, service, access);
  let actor: ChatWorkActor; let other: ChatWorkActor; let roomId: string;
  const scope = { company: 'SHOP' as const };
  beforeAll(async () => {
    await db.$connect();
    const branches = await Promise.all([1, 2].map(i => db.branch.create({ data: { name: `Follow-up ${i}` } })));
    [actor, other] = await Promise.all(branches.map(branch => db.user.create({ data: { name: 'Follow-up staff', email: `${randomUUID()}@test.invalid`, password: 'unused', role: 'SALES', branchId: branch.id, accessibleCompanies: ['SHOP'] } })));
    roomId = (await db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: actor.id } })).id;
    await db.systemConfig.upsert({ where: { key: 'chat_follow_up_enabled' }, create: { key: 'chat_follow_up_enabled', value: 'true' }, update: { value: 'true', deletedAt: null } });
  });
  afterAll(async () => db.$disconnect());
  const input = () => ({ clientRequestId: randomUUID(), title: 'โทรติดตามเอกสาร', assigneeId: actor.id, dueAt: '2026-10-06T23:59:00+07:00' });
  it('deduplicates concurrent create and commits exactly one history and inbox record', async () => {
    const request = input();
    const [a, b] = await Promise.all([service.create(roomId, request, actor, scope), service.create(roomId, request, actor, scope)]);
    expect(a.id).toBe(b.id); expect(a.workKind).toBe('CHAT_FOLLOW_UP'); expect(a.revision).toBe(0);
    expect(await db.todoWorkEvent.count({ where: { todoId: a.id } })).toBe(1);
    expect(await db.staffInboxItem.count({ where: { todoId: a.id } })).toBe(1);
  });
  it('only one racing revision wins and its due date/history is preserved', async () => {
    const task = await service.create(roomId, input(), actor, scope);
    const updates = ['2026-10-07T00:01:00+07:00', '2026-10-08T10:00:00+07:00'];
    const results = await Promise.allSettled(updates.map(dueAt => service.update(task.id, { expectedRevision: 0, dueAt }, actor, scope)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.getStatus()).toBe(409);
    const saved = await db.todo.findUniqueOrThrow({ where: { id: task.id } });
    expect(saved.revision).toBe(1); expect(saved.dueRevision).toBe(1);
    const events = await db.todoWorkEvent.findMany({ where: { todoId: task.id }, orderBy: { createdAt: 'asc' } });
    expect(events).toHaveLength(2); expect(events[1].toDueAt).toEqual(saved.dueDate);
  });
  it('increments due revision even if an appointment is moved back to its original date', async () => {
    const original = input(); const task = await service.create(roomId, original, actor, scope);
    await service.update(task.id, { expectedRevision: 0, dueAt: '2026-10-07T00:01:00+07:00' }, actor, scope);
    const restored = await service.update(task.id, { expectedRevision: 1, dueAt: original.dueAt }, actor, scope);
    expect(restored.dueRevision).toBe(2);
  });
  it.each(['DONE', 'CANCELLED'] as const)('%s removes work from active queues without changing room ownership', async status => {
    const task = await service.create(roomId, input(), actor, scope);
    await service.update(task.id, { expectedRevision: 0, status }, actor, scope);
    const result = await queue.list(actor, { ...scope, view: 'FOR_ME', page: 1, limit: 200 });
    expect(result.data.map(item => item.targetId)).not.toContain(task.id);
    expect((await db.chatRoom.findUniqueOrThrow({ where: { id: roomId } })).assignedToId).toBe(actor.id);
  });
  it('rejects cross-branch assignees and disabled accounts before writing', async () => {
    await expect(service.create(roomId, { ...input(), assigneeId: other.id }, actor, scope)).rejects.toThrow();
    await db.user.update({ where: { id: other.id }, data: { isActive: false } });
    await expect(service.create(roomId, { ...input(), assigneeId: other.id }, actor, scope)).rejects.toThrow();
  });
  it('does not let a reused request token create a task in another room', async () => {
    const request = input(); await service.create(roomId, request, actor, scope);
    const another = await db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: actor.id } });
    await expect(service.create(another.id, request, actor, scope)).rejects.toThrow();
  });
  it('generic todo routes cannot bypass room access, revision, or immutable room binding', async () => {
    const task = await service.create(roomId, input(), actor, scope);
    await expect(todos.update(task.id, { title: 'blind write' }, actor.id, 'SHOP')).rejects.toThrow();
    await expect(todos.update(task.id, { title: 'other user', expectedRevision: 0 }, other.id, 'SHOP')).rejects.toThrow();
    const updated = await todos.update(task.id, { title: 'authorized edit', expectedRevision: 0 }, actor.id, 'SHOP');
    expect(updated.revision).toBe(1);
    await expect(todos.update(task.id, { roomId: '', expectedRevision: 1 }, actor.id, 'SHOP')).rejects.toThrow();
    await expect(todos.toggleDone(task.id, actor.id, 'SHOP', 0)).rejects.toThrow();
    const done = await todos.toggleDone(task.id, actor.id, 'SHOP', 1);
    expect(done.status).toBe('DONE');
  });
  it('generic todo list/count and direct reads exclude rooms outside current company access', async () => {
    const task = await service.create(roomId, input(), actor, scope);
    const financeRoom = await db.chatRoom.create({ data: { channel: 'LINE_FINANCE', assignedToId: actor.id } });
    const hidden = await db.todo.create({ data: { title: 'hidden finance', roomId: financeRoom.id, createdById: actor.id, assigneeId: actor.id } });
    const result = await todos.findAll({ currentUserId: actor.id, company: 'SHOP', roomId, limit: 200 });
    expect(result.data.map(row => row.id)).toContain(task.id);
    expect(result.total).toBe(result.data.length);
    await expect(todos.findOne(hidden.id, actor.id, 'SHOP')).rejects.toThrow();
    await expect(todos.getComments(hidden.id, actor.id, 'SHOP')).rejects.toThrow();
  });
  it('assigns 23:59 and 00:01 to different Bangkok queue days', async () => {
    const a = await service.create(roomId, { ...input(), dueAt: '2026-10-06T23:59:00+07:00' }, actor, scope);
    const b = await service.create(roomId, { ...input(), dueAt: '2026-10-07T00:01:00+07:00' }, actor, scope);
    const day = await queue.list(actor, { ...scope, view: 'TODAY', page: 1, limit: 200 }, new Date('2026-10-06T23:58:00+07:00'));
    expect(day.data.map(row => row.targetId)).toContain(a.id);
    expect(day.data.map(row => row.targetId)).not.toContain(b.id);
    const next = await queue.list(actor, { ...scope, view: 'TODAY', page: 1, limit: 200 }, new Date('2026-10-07T00:00:00+07:00'));
    expect(next.data.map(row => row.targetId)).not.toContain(a.id);
    expect(next.data.map(row => row.targetId)).toContain(b.id);
  });
  it('work events cannot be rewritten or deleted', async () => {
    const task = await service.create(roomId, input(), actor, scope);
    const event = await db.todoWorkEvent.findFirstOrThrow({ where: { todoId: task.id } });
    await expect(db.todoWorkEvent.update({ where: { id: event.id }, data: { kind: 'CHANGED' } })).rejects.toThrow();
    await expect(db.todoWorkEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });
});
