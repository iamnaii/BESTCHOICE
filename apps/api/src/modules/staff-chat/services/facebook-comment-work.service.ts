import { enqueueCommentNotice } from './facebook-comment-inbox';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, FacebookCommentThread } from '@prisma/client';
import type { ChatWorkActor, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseBooleanFlag } from '../../../utils/config.util';
import { getBranchScope } from '../../auth/branch-access.util';
import { FacebookCommentClient } from '../../chat-adapters/facebook-comment-client';
import { ChatWorkAccessService, WORK_ROLES } from './chat-work-access.service';
import { commentWorkWhere } from './facebook-comment-scope';
import {
  AssignFacebookCommentDto,
  ConfigureFacebookCommentPageDto,
  FacebookCommentQueryDto,
  LinkFacebookCommentDto,
  StatusFacebookCommentDto,
} from '../dto/facebook-comment.dto';
@Injectable()
export class FacebookCommentWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
    private readonly client: FacebookCommentClient,
  ) {}
  private async context(
    authenticated: ChatWorkActor,
    scope: WorkScope,
    tx: Prisma.TransactionClient,
  ) {
    const actor = await this.access.currentActor(authenticated, tx);
    const where = commentWorkWhere(actor, scope);
    if (
      !parseBooleanFlag(
        (
          await tx.systemConfig.findFirst({
            where: { key: 'chat_facebook_comments_enabled', deletedAt: null },
          })
        )?.value,
        false,
      )
    )
      throw new ForbiddenException('ยังไม่เปิดคิวคอมเมนต์');
    return { actor, where };
  }
  async assertThread(
    id: string,
    actor: ChatWorkActor,
    scope: WorkScope,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const context = await this.context(actor, scope, tx);
    const thread = await tx.facebookCommentThread.findFirst({
      where: { AND: [context.where, { id }] },
    });
    if (!thread) throw new NotFoundException('ไม่พบคอมเมนต์หรือไม่มีสิทธิ์');
    return { ...context, thread };
  }
  async list(actor: ChatWorkActor, query: FacebookCommentQueryDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const context = await this.context(actor, query, tx);
        const where = { AND: [context.where, ...(query.status ? [{ status: query.status }] : [])] };
        const [total, data, open, responded, resolved] = await Promise.all([
          tx.facebookCommentThread.count({ where }),
          tx.facebookCommentThread.findMany({
            where,
            skip: (query.page - 1) * query.limit,
            take: query.limit,
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            include: {
              assignee: { select: { id: true, name: true } },
              records: {
                take: 1,
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                select: { commentId: true, text: true, authorName: true, deletedAt: true },
              },
            },
          }),
          ...(['OPEN', 'RESPONDED', 'RESOLVED'] as const).map((status) =>
            tx.facebookCommentThread.count({ where: { AND: [context.where, { status }] } }),
          ),
        ]);
        return {
          data,
          total,
          page: query.page,
          limit: query.limit,
          counts: { OPEN: open, RESPONDED: responded, RESOLVED: resolved },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async get(id: string, actor: ChatWorkActor, scope: WorkScope, recordPage = 1) {
    const result = await this.prisma.$transaction(async (tx) => {
      const { thread } = await this.assertThread(id, actor, scope, tx);
      const [records, total, assignee, replies, repliesTotal] = await Promise.all([
        tx.facebookCommentRecord.findMany({
          where: { threadId: id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (recordPage - 1) * 50,
          take: 50,
        }),
        tx.facebookCommentRecord.count({ where: { threadId: id } }),
        thread.assigneeId
          ? tx.user.findUnique({
              where: { id: thread.assigneeId },
              select: { id: true, name: true, isActive: true },
            })
          : null,
        tx.facebookCommentReply.findMany({
          where: { threadId: id },
          orderBy: [{ attemptedAt: 'desc' }, { id: 'asc' }],
          take: 50,
          skip: (recordPage - 1) * 50,
          include: { author: { select: { id: true, name: true } } },
        }),
        tx.facebookCommentReply.count({ where: { threadId: id } }),
      ]);
      const unresolvedReply = await tx.facebookCommentReply.findFirst({
        where: { threadId: id, status: { in: ['PENDING', 'UNKNOWN'] } },
        select: { id: true, status: true },
      });
      return {
        ...thread,
        records,
        recordsTotal: total,
        recordPage,
        assignee,
        replies,
        repliesTotal,
        unresolvedReply,
      };
    });
    const capabilities = await this.client.getCapabilities(result.pageId);
    // A provider read may take time; do not return details after access is revoked in the meantime.
    await this.assertThread(id, actor, scope);
    return {
      ...result,
      capabilities,
      permalink: `https://www.facebook.com/${encodeURIComponent(result.postId)}?comment_id=${encodeURIComponent(result.rootCommentId)}`,
    };
  }
  async eligible(id: string, authenticated: ChatWorkActor, scope: WorkScope) {
    return this.prisma.$transaction(async (tx) => {
      const { thread } = await this.assertThread(id, authenticated, scope, tx);
      const staff = await tx.user.findMany({
        where: {
          isActive: true,
          isSystemUser: false,
          deletedAt: null,
          role: { in: [...WORK_ROLES] },
        },
        select: { id: true, name: true, role: true, branchId: true, accessibleCompanies: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      const result: { id: string; name: string; role: string }[] = [];
      for (const person of staff) {
        try {
          if (
            await tx.facebookCommentThread.count({
              where: { AND: [commentWorkWhere(person, scope), { id: thread.id }] },
            })
          )
            result.push({ id: person.id, name: person.name, role: person.role });
        } catch (e) {
          if (!(e instanceof ForbiddenException)) throw e;
        }
      }
      return result;
    });
  }
  private async mutate(
    id: string,
    expectedRevision: number,
    authenticated: ChatWorkActor,
    scope: WorkScope,
    action: string,
    change: (
      tx: Prisma.TransactionClient,
      actor: ChatWorkActor,
      thread: FacebookCommentThread,
    ) => Promise<Prisma.FacebookCommentThreadUncheckedUpdateInput>,
    reason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM facebook_comment_threads WHERE id = ${id} FOR UPDATE`;
      const { actor, thread } = await this.assertThread(id, authenticated, scope, tx);
      if (thread.revision !== expectedRevision)
        throw new ConflictException('คอมเมนต์มีการเปลี่ยนแปลง กรุณาโหลดล่าสุด');
      const patch = await change(tx, actor, thread);
      const updated = await tx.facebookCommentThread.update({
        where: { id },
        data: { ...patch, revision: { increment: 1 } },
      });
      if (
        action === 'FACEBOOK_COMMENT_ASSIGN' &&
        updated.assigneeId &&
        updated.assigneeId !== thread.assigneeId
      )
        await enqueueCommentNotice(tx, {
          recipientId: updated.assigneeId,
          kind: 'FACEBOOK_COMMENT',
          facebookCommentId: id,
          targetType: 'FACEBOOK_COMMENT',
          targetId: id,
          title: 'มีคอมเมนต์มอบหมายถึงคุณ',
          dedupeKey: `comment-assigned:${id}:${updated.revision}:${updated.assigneeId}`,
        });
      const snapshot = (value: FacebookCommentThread) => ({
        revision: value.revision,
        status: value.status,
        assigneeId: value.assigneeId,
        customerId: value.customerId,
        roomId: value.roomId,
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action,
          entity: 'FacebookCommentThread',
          entityId: id,
          oldValue: snapshot(thread),
          newValue: { ...snapshot(updated), ...(reason ? { reason } : {}) },
        },
      });
      return updated;
    });
  }
  async linkOptions(id: string, search: string, actor: ChatWorkActor, scope: WorkScope) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertThread(id, actor, scope, tx);
      const room = await this.access.roomWhere(actor, scope, tx);
      const text = search?.trim().slice(0, 100);
      if (!text) return [];
      return tx.chatRoom.findMany({
        where: {
          AND: [
            room,
            {
              customer: { deletedAt: null },
              OR: [
                { displayName: { contains: text, mode: 'insensitive' } },
                { customer: { name: { contains: text, mode: 'insensitive' } } },
              ],
            },
          ],
        },
        select: {
          id: true,
          displayName: true,
          customerId: true,
          channel: true,
          customer: { select: { name: true } },
        },
        take: 20,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      });
    });
  }
  private async ownerPage(actor: ChatWorkActor, scope: WorkScope) {
    const current = await this.access.currentActor(actor);
    commentWorkWhere(current, scope);
    if (current.role !== 'OWNER' || scope.company !== 'SHOP')
      throw new ForbiddenException('เฉพาะเจ้าของบริษัทหน้าร้าน');
    const pageId = await this.client.configuredPageId();
    if (!pageId) throw new BadRequestException('ยังไม่ได้ตั้งค่า Facebook Page ในการเชื่อมต่อ');
    return { current, pageId };
  }
  async pageConfig(actor: ChatWorkActor, scope: WorkScope) {
    const { pageId } = await this.ownerPage(actor, scope);
    const [binding, branches, capabilities] = await Promise.all([
      this.prisma.facebookCommentPage.findUnique({ where: { pageId } }),
      this.prisma.branch.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          OR: [{ companyId: null }, { company: { companyCode: 'SHOP' } }],
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.client.getCapabilities(pageId),
    ]);
    return { pageId, binding, branches, capabilities };
  }
  async configurePage(
    input: ConfigureFacebookCommentPageDto,
    actor: ChatWorkActor,
    scope: WorkScope,
  ) {
    const { current, pageId } = await this.ownerPage(actor, scope);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pageId}, 0))::text`;
      // The ingest writer locks this same row before recording a thread.
      await tx.$queryRaw`SELECT page_id FROM facebook_comment_pages WHERE page_id = ${pageId} FOR UPDATE`;
      const fresh = await this.access.currentActor(current, tx);
      commentWorkWhere(fresh, scope);
      if (fresh.role !== 'OWNER') throw new ForbiddenException('เฉพาะเจ้าของบริษัท');
      if (
        !(await tx.branch.count({
          where: {
            id: input.branchId,
            isActive: true,
            deletedAt: null,
            OR: [{ companyId: null }, { company: { companyCode: 'SHOP' } }],
          },
        }))
      )
        throw new BadRequestException('เลือกสาขางานหน้าร้านที่เปิดใช้งาน');
      const previous = await tx.facebookCommentPage.findUnique({ where: { pageId } });
      if (
        previous &&
        previous.branchId !== input.branchId &&
        (await tx.facebookCommentThread.count({ where: { pageId } }))
      )
        throw new ConflictException('Page นี้มีประวัติงานแล้ว เปลี่ยนสาขาย้อนหลังไม่ได้');
      const binding = await tx.facebookCommentPage.upsert({
        where: { pageId },
        create: { pageId, company: 'SHOP', ...input },
        update: input,
      });
      await tx.auditLog.create({
        data: {
          userId: current.id,
          action: 'FACEBOOK_COMMENT_PAGE_CONFIGURED',
          entity: 'FacebookCommentPage',
          entityId: pageId,
          oldValue: previous
            ? { branchId: previous.branchId, enabled: previous.enabled }
            : Prisma.JsonNull,
          newValue: { branchId: binding.branchId, enabled: binding.enabled },
        },
      });
      return binding;
    });
  }
  async assign(
    id: string,
    input: AssignFacebookCommentDto,
    actor: ChatWorkActor,
    scope: WorkScope,
  ) {
    return this.mutate(
      id,
      input.expectedRevision,
      actor,
      scope,
      'FACEBOOK_COMMENT_ASSIGN',
      async (tx, _actor, thread) => {
        if (input.assigneeId) {
          const recipient = await this.access.currentActor({ id: input.assigneeId }, tx);
          if (
            !(await tx.facebookCommentThread.count({
              where: { AND: [commentWorkWhere(recipient, scope), { id: thread.id }] },
            }))
          )
            throw new ForbiddenException('ผู้รับไม่มีสิทธิ์คอมเมนต์นี้');
        }
        return { assigneeId: input.assigneeId };
      },
    );
  }
  async status(
    id: string,
    input: StatusFacebookCommentDto,
    actor: ChatWorkActor,
    scope: WorkScope,
  ) {
    if (!['OPEN', 'RESOLVED'].includes(input.status))
      throw new BadRequestException('สถานะตอบแล้วต้องมีหลักฐานการส่งสำเร็จ');
    return this.mutate(
      id,
      input.expectedRevision,
      actor,
      scope,
      'FACEBOOK_COMMENT_STATUS',
      async (_tx, _actor, thread) => {
        if (input.status === 'OPEN' && thread.rootDeleted)
          throw new ConflictException('คอมเมนต์ถูกลบแล้ว');
        return {
          status: input.status,
          waitingSince: input.status === 'OPEN' ? (thread.waitingSince ?? new Date()) : null,
        };
      },
    );
  }
  async link(id: string, input: LinkFacebookCommentDto, actor: ChatWorkActor, scope: WorkScope) {
    if (!input.reason?.trim() || input.reason.length > 1000)
      throw new BadRequestException('กรุณาระบุหลักฐานหรือเหตุผลที่ผูกข้อมูล');
    return this.mutate(
      id,
      input.expectedRevision,
      actor,
      scope,
      'FACEBOOK_COMMENT_LINK',
      async (tx, current) => {
        const customerId = input.customerId ?? null;
        const roomId = input.roomId ?? null;
        if (roomId) {
          const room = await this.access.assertRoom(roomId, current, scope, tx);
          if (room.customerId !== customerId)
            throw new BadRequestException('ลูกค้าไม่ตรงกับห้องที่เลือก');
        }
        if (customerId) {
          const branch = getBranchScope(current);
          const branchId = branch.all ? scope.branchId : branch.branchId;
          const proof: Prisma.CustomerWhereInput =
            roomId || (branch.all && !branchId)
              ? {}
              : {
                  OR: [
                    { sales: { some: { deletedAt: null, branchId: branchId! } } },
                    { contracts: { some: { deletedAt: null, branchId: branchId! } } },
                    { chatRooms: { some: await this.access.roomWhere(current, scope, tx) } },
                  ],
                };
          if (
            !(await tx.customer.count({
              where: { AND: [{ id: customerId, deletedAt: null }, proof] },
            }))
          )
            throw new NotFoundException('ไม่พบลูกค้าหรือไม่มีสิทธิ์');
        }
        return { customerId, roomId };
      },
      input.reason.trim(),
    );
  }
}
