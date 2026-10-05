import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  FacebookCommentIngestService,
  commentIdentityKey,
} from '../src/modules/chat-adapters/facebook-comment-ingest.service';
import { FacebookCommentClient } from '../src/modules/chat-adapters/facebook-comment-client';
import { IntegrationConfigService } from '../src/modules/integrations/integration-config.service';
if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use isolated chat operations harness');
describe('Durable Facebook comment ingestion', () => {
  const db = new PrismaService();
  let pageId: string;
  const config = {
    getConfig: async () => ({ pageId, pageAccessToken: 'synthetic' }),
  } as unknown as IntegrationConfigService;
  const port = {
    evidence: async () => ({ graphVersion: 'fixture', verified: true, receive: true }),
    replyPublic: jest.fn(),
    readComment: jest.fn().mockResolvedValue(null),
    readRevision: (value: Record<string, unknown>) =>
      typeof value.fixture_revision === 'string' ? value.fixture_revision : null,
  };
  const client = new FacebookCommentClient(config, port);
  const ingest = new FacebookCommentIngestService(db, config, client);
  beforeAll(async () => {
    await db.$connect();
    const branch = await db.branch.create({ data: { name: 'Comment branch' } });
    pageId = `fixture-${randomUUID()}`;
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
  const event = (
    commentId: string,
    verb = 'add',
    text = 'สนใจสินค้า',
    revision?: string,
    author = 'author-7',
  ) => ({
    id: pageId,
    time: 1791255600,
    changes: [
      {
        field: 'feed',
        value: {
          item: 'comment',
          verb,
          post_id: `${pageId}_post`,
          comment_id: commentId,
          parent_id: `${pageId}_post`,
          message: text,
          from: { id: author, name: 'ชื่อซ้ำกับลูกค้าแชท' },
          fixture_revision: revision,
        },
      },
    ],
  });
  it('deduplicates20 concurrent deliveries and never infers a customer/PSID from name or author', async () => {
    await db.customer.create({ data: { name: 'ชื่อซ้ำกับลูกค้าแชท' } });
    const id = randomUUID();
    const payload = event(id, 'add', 'สนใจสินค้า', '1');
    await Promise.all(Array.from({ length: 20 }, () => ingest.ingest(payload)));
    expect(await db.facebookCommentThread.count({ where: { pageId, rootCommentId: id } })).toBe(1);
    const thread = await db.facebookCommentThread.findUniqueOrThrow({
      where: { pageId_rootCommentId: { pageId, rootCommentId: id } },
    });
    expect(thread).toMatchObject({
      customerId: null,
      roomId: null,
      status: 'OPEN',
      inboundSequence: 1,
    });
    expect(await db.facebookCommentEvent.count({ where: { threadId: thread.id } })).toBe(1);
    expect(commentIdentityKey(pageId, 'author-7')).not.toBe(
      commentIdentityKey('another-page', 'author-7'),
    );
  });
  it('accepts distinct edits at the same timestamp and preserves the newest proven revision', async () => {
    const id = randomUUID();
    await ingest.ingest(event(id, 'add', 'แรก', '1'));
    await Promise.all([
      ingest.ingest(event(id, 'edited', 'ใหม่ที่สุด', '3')),
      ingest.ingest(event(id, 'edited', 'เก่า', '2')),
    ]);
    expect(
      await db.facebookCommentRecord.findUnique({
        where: { pageId_commentId: { pageId, commentId: id } },
      }),
    ).toMatchObject({ text: 'ใหม่ที่สุด', providerRevision: '3' });
    expect(await db.facebookCommentEvent.count({ where: { pageId, commentId: id } })).toBe(3);
  });
  it('retains remove-before-add tombstones and reconciles unorderable events without resurrection', async () => {
    const id = randomUUID();
    await ingest.ingest(event(id, 'remove', ''));
    await ingest.ingest(event(id, 'add', 'มาถึงช้า'));
    const record = await db.facebookCommentRecord.findUniqueOrThrow({
      where: { pageId_commentId: { pageId, commentId: id } },
    });
    expect(record.deletedAt).not.toBeNull();
    expect(record.text).toBeNull();
    expect(record.needsReconciliation).toBe(true);
    expect(port.readComment).toHaveBeenCalledWith(pageId, id);
  });
  it('a new customer edit reopens resolved work, but a Page self reply does not', async () => {
    const id = randomUUID();
    await ingest.ingest(event(id, 'add', 'ถาม', '1'));
    const thread = await db.facebookCommentThread.findUniqueOrThrow({
      where: { pageId_rootCommentId: { pageId, rootCommentId: id } },
    });
    await db.facebookCommentThread.update({
      where: { id: thread.id },
      data: { status: 'RESOLVED' },
    });
    const reply = event(randomUUID(), 'add', 'เพจตอบ', '1', pageId);
    reply.changes[0].value.parent_id = id;
    await ingest.ingest(reply);
    expect(
      (await db.facebookCommentThread.findUniqueOrThrow({ where: { id: thread.id } })).status,
    ).toBe('RESOLVED');
    await ingest.ingest(event(id, 'edited', 'ถามใหม่', '2'));
    expect(
      (await db.facebookCommentThread.findUniqueOrThrow({ where: { id: thread.id } })).status,
    ).toBe('OPEN');
  });
  it('ignores an unconfigured Page and fails closed without verified receive capability', async () => {
    const payload = event(randomUUID());
    payload.id = 'unknown-page';
    expect(await ingest.ingest(payload)).toMatchObject({ persisted: 0, ignored: 1 });
    const closed = new FacebookCommentIngestService(db, config, new FacebookCommentClient(config));
    await expect(closed.ingest(event(randomUUID()))).rejects.toThrow('ยังไม่ยืนยันสิทธิ์');
  });
  it('keeps the newest tombstone across concurrent add/edit/delete retries', async () => {
    const id = randomUUID();
    await Promise.all(
      [
        event(id, 'add', 'old', '1'),
        event(id, 'edited', 'changed', '2'),
        event(id, 'remove', '', '3'),
        event(id, 'add', 'old', '1'),
      ].map((payload) => ingest.ingest(payload)),
    );
    const record = await db.facebookCommentRecord.findUniqueOrThrow({
      where: { pageId_commentId: { pageId, commentId: id } },
    });
    expect(record.providerRevision).toBe('3');
    expect(record.deletedAt).not.toBeNull();
    expect(record.text).toBeNull();
    expect(await db.facebookCommentEvent.count({ where: { pageId, commentId: id } })).toBe(3);
    await expect(
      db.facebookCommentEvent.updateMany({
        where: { pageId, commentId: id },
        data: { verb: 'EDIT' },
      }),
    ).rejects.toThrow('immutable');
  });
  it('reopens resolved work only after an authoritative read confirms an unorderable customer edit', async () => {
    const id = randomUUID();
    await ingest.ingest(event(id, 'add', 'แรก', '1'));
    const thread = await db.facebookCommentThread.findUniqueOrThrow({
      where: { pageId_rootCommentId: { pageId, rootCommentId: id } },
    });
    await db.facebookCommentThread.update({
      where: { id: thread.id },
      data: { status: 'RESOLVED', waitingSince: null },
    });
    port.readComment.mockResolvedValueOnce({
      commentId: id,
      exists: true,
      text: 'แก้ไขแล้วจากต้นทาง',
      revision: null,
    });
    await ingest.ingest(event(id, 'edited', 'unproven incoming'));
    expect(await db.facebookCommentThread.findUnique({ where: { id: thread.id } })).toMatchObject({
      status: 'OPEN',
      inboundSequence: 2,
      needsReconciliation: false,
    });
    expect(
      await db.facebookCommentRecord.findUnique({
        where: { pageId_commentId: { pageId, commentId: id } },
      }),
    ).toMatchObject({ text: 'แก้ไขแล้วจากต้นทาง', needsReconciliation: false });
  });
  it('rolls back projections if durable event persistence fails and succeeds on retry', async () => {
    const id = randomUUID();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION test_reject_fb_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic comment failure'; END; $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER test_reject_fb_event BEFORE INSERT ON facebook_comment_events FOR EACH ROW EXECUTE FUNCTION test_reject_fb_event()',
    );
    try {
      await expect(ingest.ingest(event(id))).rejects.toThrow();
      expect(await db.facebookCommentThread.count({ where: { pageId, rootCommentId: id } })).toBe(
        0,
      );
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_reject_fb_event ON facebook_comment_events');
      await db.$executeRawUnsafe('DROP FUNCTION test_reject_fb_event()');
    }
    expect(await ingest.ingest(event(id))).toMatchObject({ persisted: 1 });
  });
});
