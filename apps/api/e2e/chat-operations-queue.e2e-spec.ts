import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { ChatWorkQueryService } from '../src/modules/staff-chat/services/chat-work-query.service';
import type { ChatWorkActor } from '@installment/shared';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Use isolated chat operations harness');
describe('Work queue uses identical scoped row and count predicates', () => {
  const db = new PrismaService();
  const service = new ChatWorkQueryService(db, new ChatWorkAccessService(db));
  let actor: ChatWorkActor;
  let roomId: string;
  let baseline: Awaited<ReturnType<ChatWorkQueryService["list"]>>;
  const now = new Date('2026-10-06T05:00:00Z');
  beforeAll(async () => {
    await db.$connect();
    const branch = await db.branch.create({ data: { name: 'Queue isolated' } });
    actor = await db.user.create({ data: { name: 'Queue actor', email: `${randomUUID()}@test.invalid`, password: 'unused', role: 'SALES', branchId: branch.id, accessibleCompanies: ['SHOP'] } });
    baseline = await service.list(actor, { company: 'SHOP', view: 'WAITING', page: 1, limit: 200 }, now);
    roomId = (await db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: actor.id, waitingSince: now, unreadCount: 0 } })).id;
    await db.chatRoom.create({ data: { channel: 'LINE_FINANCE', assignedToId: actor.id, waitingSince: now } });
    const hidden = await db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: actor.id, deletedAt: now } });
    for (const [title, dueDate, status, room] of [
      ['today start', '2026-10-05T17:00:00Z', 'TODO', roomId],
      ['today end', '2026-10-06T16:59:59Z', 'DOING', roomId],
      ['tomorrow', '2026-10-06T17:00:00Z', 'TODO', roomId],
      ['yesterday', '2026-10-05T16:59:59Z', 'REVIEW', roomId],
      ['done', '2026-10-06T04:00:00Z', 'DONE', roomId],
      ['hidden', '2026-10-06T04:00:00Z', 'TODO', hidden.id],
    ] as const) await db.todo.create({ data: { title, dueDate: new Date(dueDate), status, roomId: room, createdById: actor.id, assigneeId: actor.id } });
  });
  afterAll(async () => db.$disconnect());
  it('keeps an already-read room waiting, counts Bangkok boundaries, and excludes deleted/cross-company rooms', async () => {
    const result = await service.list(actor, { company: 'SHOP', view: 'WAITING', page: 1, limit: 50 }, now);
    expect(result.data.map(item => item.targetId)).toContain(roomId);
    expect(result.total).toBe(baseline.total + 1);
    expect(result.counts).toEqual({ WAITING: baseline.counts.WAITING + 1, UNASSIGNED: baseline.counts.UNASSIGNED, TODAY: baseline.counts.TODAY + 2, OVERDUE: baseline.counts.OVERDUE + 2, FOR_ME: 4 });
    const today = await service.list(actor, { company: 'SHOP', view: 'TODAY', page: 1, limit: 50 }, now);
    expect(today.data.filter(item => item.roomId === roomId).map(item => item.title)).toEqual(['today start', 'today end']);
  });
  it('paginates work, not room ownership, and rechecks revoked access', async () => {
    const first = await service.list(actor, { company: 'SHOP', view: 'FOR_ME', page: 1, limit: 2 }, now);
    const second = await service.list(actor, { company: 'SHOP', view: 'FOR_ME', page: 2, limit: 2 }, now);
    expect(first.total).toBe(4);
    expect(new Set([...first.data, ...second.data].map(item => item.key)).size).toBe(4);
    await db.user.update({ where: { id: actor.id }, data: { accessibleCompanies: ['FINANCE'] } });
    await expect(service.list(actor, { company: 'SHOP', view: 'WAITING', page: 1, limit: 50 }, now)).rejects.toThrow();
  });
});
