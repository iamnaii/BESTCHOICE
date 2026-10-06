import { randomUUID } from 'node:crypto';
import type { ChatWorkActor } from '@installment/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { IntegrationConfigService } from '../src/modules/integrations/integration-config.service';
import {
  FacebookCommentClient,
  FacebookCommentSnapshot,
} from '../src/modules/chat-adapters/facebook-comment-client';
import { FacebookCommentIngestService } from '../src/modules/chat-adapters/facebook-comment-ingest.service';
import { FacebookCommentReplyService } from '../src/modules/chat-adapters/facebook-comment-reply.service';
import { FacebookCommentWorkService } from '../src/modules/staff-chat/services/facebook-comment-work.service';
import { FacebookCommentRefreshService } from '../src/modules/staff-chat/services/facebook-comment-refresh.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use isolated chat operations harness');

describe('Unversioned live comment recovery without resurrection or duplicate delivery', () => {
  const db = new PrismaService();
  const pageId = `recovery-${randomUUID()}`;
  const postId = `${pageId}_post`;
  const scope = { company: 'SHOP' as const };
  const snapshots = new Map<string, FacebookCommentSnapshot>();
  const config = {
    getConfig: async () => ({ pageId, pageAccessToken: 'synthetic' }),
  } as unknown as IntegrationConfigService;
  const port = {
    evidence: async () => ({
      graphVersion: 'synthetic',
      verified: true,
      receive: true,
      publicReply: true,
    }),
    readComment: jest.fn(async (_page: string, id: string) => snapshots.get(id) ?? null),
    replyPublic: jest.fn(async () => ({ externalId: `ack-${randomUUID()}` })),
  };
  const client = new FacebookCommentClient(config, port);
  const ingest = new FacebookCommentIngestService(db, config, client);
  const work = new FacebookCommentWorkService(db, new ChatWorkAccessService(db), client);
  const refresh = new FacebookCommentRefreshService(db, work, ingest);
  const replies = new FacebookCommentReplyService(db, work, client);
  let owner: ChatWorkActor;
  let foreign: ChatWorkActor;
  const event = (id: string, verb = 'add', parent = postId, text = 'คำถาม') => ({
    id: pageId,
    changes: [
      {
        field: 'feed',
        value: {
          item: 'comment',
          verb,
          comment_id: id,
          post_id: postId,
          parent_id: parent,
          from: { id: 'customer' },
          message: text,
        },
      },
    ],
  });
  const available = (id: string, text = 'คำถาม') =>
    snapshots.set(id, { commentId: id, exists: true, text, revision: null });
  const threadFor = (id: string) =>
    db.facebookCommentThread.findUniqueOrThrow({
      where: { pageId_rootCommentId: { pageId, rootCommentId: id } },
    });
  const recordFor = (id: string) =>
    db.facebookCommentRecord.findUniqueOrThrow({
      where: { pageId_commentId: { pageId, commentId: id } },
    });
  beforeAll(async () => {
    await db.$connect();
    const branch = await db.branch.create({ data: { name: 'Recovery branch' } });
    const elsewhere = await db.branch.create({ data: { name: 'Elsewhere' } });
    [owner, foreign] = await Promise.all([
      db.user.create({
        data: {
          name: 'Owner',
          email: `${randomUUID()}@test.invalid`,
          password: 'unused',
          role: 'OWNER',
          accessibleCompanies: ['SHOP'],
          branchId: branch.id,
        },
      }),
      db.user.create({
        data: {
          name: 'Foreign seller',
          email: `${randomUUID()}@test.invalid`,
          password: 'unused',
          role: 'SALES',
          accessibleCompanies: ['SHOP'],
          branchId: elsewhere.id,
        },
      }),
    ]);
    await db.facebookCommentPage.create({
      data: { pageId, company: 'SHOP', branchId: branch.id, enabled: true },
    });
    await db.systemConfig.upsert({
      where: { key: 'chat_facebook_comments_enabled' },
      create: { key: 'chat_facebook_comments_enabled', value: 'true' },
      update: { value: 'true', deletedAt: null },
    });
  });
  afterAll(() => db.$disconnect());
  beforeEach(() => {
    port.readComment.mockClear();
    port.replyPublic.mockClear();
  });

  it('recovers a failed initial GET through a scoped manual refresh', async () => {
    const id = randomUUID();
    await ingest.ingest(event(id));
    const thread = await threadFor(id);
    const record = await recordFor(id);
    expect(thread.needsReconciliation).toBe(true);
    available(id);
    await expect(refresh.refresh(thread.id, record.id, foreign, scope)).rejects.toThrow();
    await expect(
      refresh.refresh(thread.id, record.id, owner, { company: 'FINANCE' }),
    ).rejects.toThrow();
    await expect(refresh.refresh(thread.id, randomUUID(), owner, scope)).rejects.toThrow();
    expect(await refresh.refresh(thread.id, record.id, owner, scope)).toEqual({ refreshed: true });
    expect((await threadFor(id)).needsReconciliation).toBe(false);
    expect(port.replyPublic).not.toHaveBeenCalled();
  });
  it('retries only the provider GET on a duplicate callback without incrementing inbound sequence', async () => {
    const id = randomUUID();
    const payload = event(id);
    await ingest.ingest(payload);
    const before = await threadFor(id);
    available(id);
    expect(await ingest.ingest(payload)).toEqual({ persisted: 0, ignored: 1 });
    expect(await threadFor(id)).toMatchObject({
      inboundSequence: before.inboundSequence,
      needsReconciliation: false,
    });
    expect(
      await db.facebookCommentEvent.count({ where: { pageId, commentId: id, verb: 'ADD' } }),
    ).toBe(1);
    expect(port.replyPublic).not.toHaveBeenCalled();
  });
  it('keeps a deleted child ambiguous and tombstoned while allowing replies to its verified root', async () => {
    const root = randomUUID();
    available(root);
    await ingest.ingest(event(root));
    const child = randomUUID();
    available(child);
    await ingest.ingest(event(child, 'add', root));
    snapshots.delete(child);
    await ingest.ingest(event(child, 'remove', root, ''));
    // An old ADD retry cannot clear this tombstone even though root replies remain allowed.
    await ingest.ingest(event(child, 'add', root));
    const thread = await threadFor(root);
    const record = await recordFor(child);
    expect(record.deletedAt).not.toBeNull();
    expect(record.needsReconciliation).toBe(true);
    expect(record.text).toBeNull();
    expect(thread).toMatchObject({ rootDeleted: false, needsReconciliation: false });
    expect(
      await replies.reply(
        thread.id,
        { clientRequestId: randomUUID(), text: 'ตอบที่ต้นทาง' },
        owner,
        scope,
      ),
    ).toMatchObject({ status: 'CONFIRMED' });
    snapshots.delete(root);
    await ingest.ingest(event(root, 'remove', postId, ''));
    await expect(
      replies.reply(
        thread.id,
        { clientRequestId: randomUUID(), text: 'ห้ามตอบต้นทางที่ลบ' },
        owner,
        scope,
      ),
    ).rejects.toThrow('ถูกลบ');
    expect(port.replyPublic).toHaveBeenCalledTimes(1);
  });
  it('unblocks a child that arrived before its parent only after an authoritative retry', async () => {
    const root = randomUUID();
    const child = randomUUID();
    available(child);
    await ingest.ingest(event(child, 'add', root));
    expect((await threadFor(root)).needsReconciliation).toBe(true);
    available(root);
    await ingest.ingest(event(root));
    expect((await threadFor(root)).needsReconciliation).toBe(true);
    const thread = await threadFor(root);
    const record = await recordFor(child);
    await refresh.refresh(thread.id, record.id, owner, scope);
    expect((await threadFor(root)).needsReconciliation).toBe(false);
  });
  it('recovers an older missing root only from matching authoritative topology, without a root webhook', async () => {
    const root = randomUUID();
    const child = randomUUID();
    available(child);
    await ingest.ingest(event(child, 'add', root));
    const thread = await threadFor(root);
    expect((await work.get(thread.id, owner, scope)).rootRecordMissing).toBe(true);
    snapshots.set(root, {
      commentId: root,
      exists: true,
      text: 'ข้อมูลต้นทาง',
      revision: null,
      postId: 'wrong-post',
      parentCommentId: null,
      authorId: 'root-author',
    });
    expect(await refresh.refreshRoot(thread.id, owner, scope)).toEqual({ refreshed: false });
    snapshots.set(root, {
      commentId: root,
      exists: true,
      text: 'ข้อมูลต้นทาง',
      revision: null,
      postId,
      parentCommentId: child,
      authorId: 'root-author',
    });
    expect(await refresh.refreshRoot(thread.id, owner, scope)).toEqual({ refreshed: false });
    expect(await db.facebookCommentRecord.count({ where: { pageId, commentId: root } })).toBe(0);
    snapshots.set(root, {
      commentId: root,
      exists: true,
      text: 'ข้อมูลต้นทาง',
      revision: null,
      postId,
      parentCommentId: null,
      authorId: 'root-author',
    });
    expect(await refresh.refreshRoot(thread.id, owner, scope)).toEqual({ refreshed: true });
    expect(await recordFor(root)).toMatchObject({
      text: 'ข้อมูลต้นทาง',
      authorId: 'root-author',
      threadId: thread.id,
    });
    const childRecord = await recordFor(child);
    await refresh.refresh(thread.id, childRecord.id, owner, scope);
    expect(await work.get(thread.id, owner, scope)).toMatchObject({
      rootRecordMissing: false,
      needsReconciliation: false,
      inboundSequence: thread.inboundSequence,
    });
  });

  it('rejects a stale snapshot when a signed webhook changes the thread during GET', async () => {
    const id = randomUUID();
    await ingest.ingest(event(id));
    const before = await threadFor(id);
    const record = await recordFor(id);
    let resolve!: (value: FacebookCommentSnapshot) => void;
    let started!: () => void;
    const reading = new Promise<void>((r) => {
      started = r;
    });
    port.readComment.mockImplementationOnce(() => {
      started();
      return new Promise((r) => {
        resolve = r;
      });
    });
    const pending = refresh.refresh(before.id, record.id, owner, scope);
    await reading;
    await ingest.ingest(event(id, 'remove', postId, ''));
    resolve({ commentId: id, exists: true, text: 'stale resurrection', revision: null });
    expect(await pending).toEqual({ refreshed: false });
    expect((await recordFor(id)).deletedAt).not.toBeNull();
    expect((await threadFor(id)).rootDeleted).toBe(true);
  });
  it('rechecks staff access before applying a snapshot', async () => {
    const id = randomUUID();
    await ingest.ingest(event(id));
    const thread = await threadFor(id);
    const record = await recordFor(id);
    port.readComment.mockImplementationOnce(async () => {
      await db.user.update({ where: { id: owner.id }, data: { isActive: false } });
      return { commentId: id, exists: true, text: 'do not apply', revision: null };
    });
    try {
      await expect(refresh.refresh(thread.id, record.id, owner, scope)).rejects.toThrow();
      expect((await recordFor(id)).text).toBe('คำถาม');
      expect((await threadFor(id)).needsReconciliation).toBe(true);
    } finally {
      await db.user.update({ where: { id: owner.id }, data: { isActive: true } });
    }
  });
});
