import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, FacebookCommentPage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { parseBooleanFlag } from '../../utils/config.util';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { FacebookCommentClient } from './facebook-comment-client';
export const commentIdentityKey = (pageId: string, authorId: string) =>
  `facebook-comment:${pageId}:${authorId}`;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown, max: number) =>
  typeof value === 'string' && value.length <= max ? value : null;
@Injectable()
export class FacebookCommentIngestService {
  private readonly logger = new Logger(FacebookCommentIngestService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: IntegrationConfigService,
    private readonly client: FacebookCommentClient,
  ) {}
  async ingest(raw: unknown): Promise<{ persisted: number; ignored: number }> {
    const entry = object(raw);
    const changes = (Array.isArray(entry.changes) ? entry.changes : [])
      .map(object)
      .filter((change) => change.field === 'feed' && object(change.value).item === 'comment');
    if (!changes.length) return { persisted: 0, ignored: 0 };
    const flag = await this.prisma.systemConfig.findFirst({
      where: { key: 'chat_facebook_comments_enabled', deletedAt: null },
    });
    if (!parseBooleanFlag(flag?.value, false)) return { persisted: 0, ignored: changes.length };
    const pageId = string(entry.id, 128);
    const config = await this.config.getConfig('facebook');
    const page =
      pageId && pageId === config.pageId
        ? await this.prisma.facebookCommentPage.findUnique({ where: { pageId } })
        : null;
    if (!page?.enabled) {
      this.logger.warn('facebook_comment_ignored: unknown_or_disabled_page');
      return { persisted: 0, ignored: changes.length };
    }
    const capabilities = await this.client.getCapabilities(page.pageId);
    if (!capabilities.receive)
      throw new ServiceUnavailableException(
        capabilities.reason || 'ยังไม่ยืนยันสิทธิ์การเชื่อมต่อ',
      );
    let persisted = 0;
    for (const change of changes) {
      const value = object(change.value);
      const result = await this.persist(page, value, entry.time);
      if (!result) continue;
      persisted++;
      // Persistence has already committed. A failed provider read never loses the event/tombstone.
      if (result.reconcile)
        await this.reconcile(result.threadId, result.commentId, result.revision);
    }
    return { persisted, ignored: changes.length - persisted };
  }
  private async persist(
    page: FacebookCommentPage,
    value: Record<string, unknown>,
    rawTime: unknown,
  ) {
    const commentId = string(value.comment_id, 256);
    const postId = string(value.post_id, 256);
    const verb =
      value.verb === 'edit' || value.verb === 'edited'
        ? 'EDIT'
        : value.verb === 'add'
          ? 'ADD'
          : value.verb === 'remove'
            ? 'REMOVE'
            : null;
    if (!commentId || !postId || !verb)
      throw new BadRequestException('รูปแบบเหตุการณ์คอมเมนต์ไม่ครบ');
    const parentId = string(value.parent_id, 256);
    const author = object(value.from);
    const authorId = string(author.id, 128);
    const authorName = string(author.name, 255);
    const text = typeof value.message === 'string' ? value.message.slice(0, 20000) : null;
    const providerRevision = this.client.revisionOf(value);
    const rawSeconds = Number(value.created_time ?? rawTime);
    const providerAt =
      Number.isFinite(rawSeconds) && rawSeconds > 0 && rawSeconds < 1e11
        ? new Date(rawSeconds * 1000)
        : null;
    const eventKey = createHash('sha256')
      .update(
        JSON.stringify([
          page.pageId,
          postId,
          commentId,
          parentId,
          verb,
          providerRevision,
          authorId,
          text,
          providerAt?.toISOString(),
        ]),
      )
      .digest('hex');
    return this.prisma.$transaction(
      async (tx) => {
        // Lock the configured Page first: root discovery and concurrent child/root arrival share this lock.
        await tx.$queryRaw`SELECT page_id FROM facebook_comment_pages WHERE page_id = ${page.pageId} FOR UPDATE`;
        const currentPage = await tx.facebookCommentPage.findUnique({
          where: { pageId: page.pageId },
        });
        if (!currentPage?.enabled)
          throw new ServiceUnavailableException('เพจถูกปิดรับคอมเมนต์แล้ว');
        if (await tx.facebookCommentEvent.count({ where: { eventKey } })) return null;
        const existing = await tx.facebookCommentRecord.findUnique({
          where: { pageId_commentId: { pageId: page.pageId, commentId } },
          include: { thread: true },
        });
        const parent =
          parentId && parentId !== postId
            ? await tx.facebookCommentRecord.findUnique({
                where: { pageId_commentId: { pageId: page.pageId, commentId: parentId } },
                include: { thread: true },
              })
            : null;
        const rootCommentId =
          existing?.thread.rootCommentId ??
          parent?.thread.rootCommentId ??
          (parentId && parentId !== postId ? parentId : commentId);
        const thread = await tx.facebookCommentThread.upsert({
          where: { pageId_rootCommentId: { pageId: page.pageId, rootCommentId } },
          create: {
            pageId: page.pageId,
            postId,
            rootCommentId,
            company: currentPage.company,
            branchId: currentPage.branchId,
          },
          update: {},
        });
        await tx.$queryRaw`SELECT id FROM facebook_comment_threads WHERE id = ${thread.id} FOR UPDATE`;
        if (thread.postId !== postId) throw new BadRequestException('คอมเมนต์ไม่ตรงกับโพสต์เดิม');
        await tx.facebookCommentEvent.create({
          data: {
            threadId: thread.id,
            pageId: page.pageId,
            commentId,
            eventKey,
            verb,
            providerRevision,
            providerAt,
            payload: JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue,
          },
        });
        const previous = existing;
        const comparable = !!previous?.providerRevision && !!providerRevision;
        const newer = comparable
          ? BigInt(providerRevision!) > BigInt(previous!.providerRevision!)
          : !previous;
        const same =
          comparable && BigInt(providerRevision!) === BigInt(previous!.providerRevision!);
        const ambiguous =
          !!previous &&
          (!comparable ||
            (same && (previous.text !== text || !!previous.deletedAt !== (verb === 'REMOVE'))));
        const reconcile =
          ambiguous ||
          !providerRevision ||
          (!!previous?.deletedAt && verb !== 'REMOVE' && newer) ||
          (!!parentId && parentId !== postId && !parent);
        // Without an ordering proof removal wins conservatively. Arrival order cannot undo a tombstone.
        const remove = verb === 'REMOVE' && (newer || !comparable || same);
        const apply = newer && !previous?.deletedAt && verb !== 'REMOVE';
        const record = previous
          ? await tx.facebookCommentRecord.update({
              where: { id: previous.id },
              data: {
                ...(apply ? { text, authorId, authorName, providerRevision } : {}),
                ...(remove
                  ? {
                      text: null,
                      deletedAt: new Date(),
                      providerRevision: newer ? providerRevision : previous.providerRevision,
                    }
                  : {}),
                needsReconciliation: previous.needsReconciliation || reconcile,
              },
            })
          : await tx.facebookCommentRecord.create({
              data: {
                threadId: thread.id,
                pageId: page.pageId,
                commentId,
                parentId,
                authorId,
                authorName,
                text: verb === 'REMOVE' ? null : text,
                providerRevision,
                deletedAt: verb === 'REMOVE' ? new Date() : null,
                needsReconciliation: reconcile,
              },
            });
        const customerUpdate =
          authorId !== page.pageId && verb !== 'REMOVE' && (!previous || apply);
        const rootDeleted = commentId === rootCommentId ? !!record.deletedAt : thread.rootDeleted;
        const updated = await tx.facebookCommentThread.update({
          where: { id: thread.id },
          data: {
            revision: { increment: 1 },
            rootDeleted,
            needsReconciliation: thread.needsReconciliation || reconcile,
            ...(rootDeleted
              ? { waitingSince: null }
              : customerUpdate
                ? {
                    status: 'OPEN',
                    inboundSequence: { increment: 1 },
                    waitingSince:
                      thread.status === 'OPEN' && thread.waitingSince
                        ? thread.waitingSince
                        : new Date(),
                    lastCustomerAt: new Date(),
                  }
                : {}),
          },
        });
        return { threadId: thread.id, commentId, revision: updated.revision, reconcile };
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }
  async reconcile(threadId: string, commentId: string, expectedRevision: number) {
    const thread = await this.prisma.facebookCommentThread.findUnique({ where: { id: threadId } });
    if (!thread) return false;
    const snapshot = await this.client.readComment(thread.pageId, commentId);
    if (!snapshot || snapshot.commentId !== commentId) return false;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM facebook_comment_threads WHERE id = ${threadId} FOR UPDATE`;
      const current = await tx.facebookCommentThread.findUniqueOrThrow({ where: { id: threadId } });
      if (current.revision !== expectedRevision) return false;
      const record = await tx.facebookCommentRecord.findUniqueOrThrow({
        where: { pageId_commentId: { pageId: thread.pageId, commentId } },
      });
      if (
        snapshot.revision &&
        record.providerRevision &&
        BigInt(snapshot.revision) < BigInt(record.providerRevision)
      )
        return false;
      await tx.facebookCommentEvent.createMany({
        data: [
          {
            threadId,
            pageId: current.pageId,
            commentId,
            verb: 'RECONCILE',
            providerRevision: snapshot.revision,
            payload: snapshot as unknown as Prisma.InputJsonValue,
            eventKey: createHash('sha256')
              .update(JSON.stringify(['RECONCILE', current.pageId, commentId, snapshot]))
              .digest('hex'),
          },
        ],
        skipDuplicates: true,
      });
      const unresolvedParent =
        !!record.parentId &&
        record.parentId !== current.postId &&
        !(await tx.facebookCommentRecord.count({
          where: { pageId: current.pageId, commentId: record.parentId, threadId },
        }));
      const customerChanged =
        snapshot.exists &&
        record.authorId !== current.pageId &&
        (record.text !== snapshot.text || !!record.deletedAt) &&
        (commentId === current.rootCommentId || !current.rootDeleted);
      await tx.facebookCommentRecord.update({
        where: { id: record.id },
        data: {
          text: snapshot.exists ? snapshot.text : null,
          deletedAt: snapshot.exists ? null : (record.deletedAt ?? new Date()),
          providerRevision: snapshot.revision,
          needsReconciliation: unresolvedParent,
        },
      });
      const remaining = await tx.facebookCommentRecord.count({
        where: { threadId, needsReconciliation: true },
      });
      await tx.facebookCommentThread.update({
        where: { id: threadId },
        data: {
          revision: { increment: 1 },
          needsReconciliation: remaining > 0,
          ...(customerChanged
            ? {
                status: 'OPEN',
                inboundSequence: { increment: 1 },
                waitingSince:
                  current.status === 'OPEN' && current.waitingSince
                    ? current.waitingSince
                    : new Date(),
                lastCustomerAt: new Date(),
              }
            : {}),
          ...(commentId === thread.rootCommentId
            ? { rootDeleted: !snapshot.exists, ...(!snapshot.exists ? { waitingSince: null } : {}) }
            : {}),
        },
      });
      return true;
    });
  }
}
