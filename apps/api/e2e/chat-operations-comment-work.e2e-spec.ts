import { randomUUID } from 'node:crypto';
import type { ChatWorkActor } from '@installment/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { FacebookCommentClient } from '../src/modules/chat-adapters/facebook-comment-client';
import { FacebookCommentWorkService } from '../src/modules/staff-chat/services/facebook-comment-work.service';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use isolated chat operations harness');
describe('Scoped comment work and explicit identity links', () => {
  const db = new PrismaService();
  const access = new ChatWorkAccessService(db);
  const client = {
    getCapabilities: async () => ({
      receive: false,
      publicReply: false,
      privateReply: false,
      graphVersion: 'v25.0',
      reason: 'unverified',
    }),
  } as unknown as FacebookCommentClient;
  const service = new FacebookCommentWorkService(db, access, client);
  let owner: ChatWorkActor;
  let seller: ChatWorkActor;
  let other: ChatWorkActor;
  let branchId: string;
  let foreignBranch: string;
  let pageId: string;
  const scope = { company: 'SHOP' as const };
  beforeAll(async () => {
    await db.$connect();
    [branchId, foreignBranch] = (
      await Promise.all(
        ['Comment A', 'Comment B'].map((name) => db.branch.create({ data: { name } })),
      )
    ).map((b) => b.id);
    [owner, seller, other] = await Promise.all(
      ['OWNER', 'SALES', 'SALES'].map((role, i) =>
        db.user.create({
          data: {
            name: `Comment staff${i}`,
            email: `${randomUUID()}@test.invalid`,
            password: 'unused',
            role: role as 'OWNER' | 'SALES',
            accessibleCompanies: ['SHOP'],
            branchId: i === 2 ? foreignBranch : branchId,
          },
        }),
      ),
    );
    pageId = randomUUID();
    await db.facebookCommentPage.create({
      data: { pageId, branchId, company: 'SHOP', enabled: true },
    });
    await db.systemConfig.upsert({
      where: { key: 'chat_facebook_comments_enabled' },
      create: { key: 'chat_facebook_comments_enabled', value: 'true' },
      update: { value: 'true', deletedAt: null },
    });
  });
  afterAll(() => db.$disconnect());
  const create = () =>
    db.facebookCommentThread.create({
      data: {
        pageId,
        rootCommentId: randomUUID(),
        postId: 'post',
        company: 'SHOP',
        branchId,
        waitingSince: new Date(),
      },
    });
  it('uses the same company/branch/assignee scope for count, list and exact target', async () => {
    const task = await create();
    const own = await service.list(seller, { ...scope, page: 1, limit: 200 });
    expect(own.data.some((row) => row.id === task.id)).toBe(true);
    expect(own.total).toBe(own.data.length);
    expect(
      (await service.list(other, { ...scope, page: 1, limit: 200 })).data.some(
        (row) => row.id === task.id,
      ),
    ).toBe(false);
    await expect(service.get(task.id, other, scope)).rejects.toThrow();
    await expect(service.get(task.id, owner, { company: 'FINANCE' })).rejects.toThrow();
  });
  it('assigns only currently eligible staff and preserves room ownership on explicit link/unlink', async () => {
    const task = await create();
    await expect(
      service.assign(task.id, { expectedRevision: 0, assigneeId: other.id }, owner, scope),
    ).rejects.toThrow();
    const assigned = await service.assign(
      task.id,
      { expectedRevision: 0, assigneeId: seller.id },
      owner,
      scope,
    );
    expect(assigned.revision).toBe(1);
    const customer = await db.customer.create({ data: { name: 'Explicit linked customer' } });
    const room = await db.chatRoom.create({
      data: { channel: 'FACEBOOK', customerId: customer.id, assignedToId: seller.id },
    });
    await expect(
      service.link(
        task.id,
        { expectedRevision: 1, customerId: customer.id, roomId: room.id, reason: '' },
        owner,
        scope,
      ),
    ).rejects.toThrow();
    const linked = await service.link(
      task.id,
      {
        expectedRevision: 1,
        customerId: customer.id,
        roomId: room.id,
        reason: 'ลูกค้ายืนยันเลขคำสั่งซื้อในช่องทางเดิม',
      },
      owner,
      scope,
    );
    expect(linked).toMatchObject({ customerId: customer.id, roomId: room.id, revision: 2 });
    await service.link(
      task.id,
      { expectedRevision: 2, customerId: null, roomId: null, reason: 'ตรวจแล้วเป็นคนละคน' },
      owner,
      scope,
    );
    expect((await db.chatRoom.findUniqueOrThrow({ where: { id: room.id } })).assignedToId).toBe(
      seller.id,
    );
    expect(
      await db.auditLog.count({ where: { entityId: task.id, action: 'FACEBOOK_COMMENT_LINK' } }),
    ).toBe(2);
  });
  it('rejects mismatched customer, foreign room and stale mutation; manual status cannot claim a public reply', async () => {
    const task = await create();
    const customer = await db.customer.create({ data: { name: 'Foreign' } });
    const room = await db.chatRoom.create({
      data: { channel: 'LINE_FINANCE', customerId: customer.id },
    });
    await expect(
      service.link(
        task.id,
        { expectedRevision: 0, customerId: customer.id, roomId: room.id, reason: 'same name' },
        owner,
        scope,
      ),
    ).rejects.toThrow();
    const ownRoom = await db.chatRoom.create({ data: { channel: 'FACEBOOK', assignedToId: seller.id } });
    await expect(service.link(task.id, { expectedRevision: 0, customerId: customer.id, roomId: ownRoom.id, reason: 'ต้องตรงกันทั้งสองตัว' }, owner, scope)).rejects.toThrow('ลูกค้าไม่ตรง');
    await service.status(task.id, { expectedRevision: 0, status: 'RESOLVED' }, owner, scope);
    await expect(
      service.status(task.id, { expectedRevision: 0, status: 'OPEN' }, owner, scope),
    ).rejects.toThrow();
    await expect(
      service.status(task.id, { expectedRevision: 1, status: 'RESPONDED' as 'OPEN' }, owner, scope),
    ).rejects.toThrow();
    const reopened = await service.status(
      task.id,
      { expectedRevision: 1, status: 'OPEN' },
      owner,
      scope,
    );
    expect(reopened.waitingSince).not.toBeNull();
  });
  it('refreshes actor grants and treats disabled staff as ineligible', async () => {
    const task = await create();
    await db.user.update({ where: { id: seller.id }, data: { accessibleCompanies: ['FINANCE'] } });
    await expect(service.get(task.id, seller, scope)).rejects.toThrow();
    await expect(
      service.assign(task.id, { expectedRevision: 0, assigneeId: seller.id }, owner, scope),
    ).rejects.toThrow();
    await db.user.update({ where: { id: seller.id }, data: { accessibleCompanies: ['SHOP'] } });
    await db.user.update({ where: { id: seller.id }, data: { isActive: false } });
    await expect(service.assign(task.id,{ expectedRevision: 0, assigneeId: seller.id },owner,scope)).rejects.toThrow();
    await db.user.update({ where: { id: seller.id }, data: { isActive: true } });

  });
});
