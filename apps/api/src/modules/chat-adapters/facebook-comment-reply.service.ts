import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FacebookCommentReply, Prisma } from '@prisma/client';
import type { ChatWorkActor, WorkScope } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { FacebookCommentWorkService } from '../staff-chat/services/facebook-comment-work.service';
import { FacebookCommentClient, FacebookCommentSendResult } from './facebook-comment-client';
@Injectable()
export class FacebookCommentReplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly work: FacebookCommentWorkService,
    private readonly client: FacebookCommentClient,
  ) {}
  async reply(
    threadId: string,
    input: { clientRequestId: string; text: string },
    actor: ChatWorkActor,
    scope: WorkScope,
  ) {
    const text = input.text?.trim();
    if (!text || text.length > 5000)
      throw new BadRequestException('กรุณาพิมพ์คำตอบสาธารณะไม่เกิน5000ตัวอักษร');
    const requestKey = `fb-comment:${actor.id}:${input.clientRequestId}`;
    const { thread } = await this.work.assertThread(threadId, actor, scope);
    const retry = await this.prisma.facebookCommentReply.findUnique({ where: { requestKey } });
    if (retry) return this.sameRequest(retry, threadId, text);
    const caps = await this.client.getCapabilities(thread.pageId);
    if (!caps.publicReply)
      throw new ConflictException(caps.reason || 'ยังไม่เปิดสิทธิ์ตอบคอมเมนต์สาธารณะ');
    const prepared = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM facebook_comment_threads WHERE id = ${threadId} FOR UPDATE`;
      const { thread: current } = await this.work.assertThread(threadId, actor, scope, tx);
      const existing = await tx.facebookCommentReply.findUnique({ where: { requestKey } });
      if (existing) return { row: this.sameRequest(existing, threadId, text), created: false };
      if (current.rootDeleted) throw new ConflictException('คอมเมนต์ถูกลบแล้ว');
      if (current.needsReconciliation)
        throw new ConflictException('ต้องตรวจสถานะคอมเมนต์จากต้นทางก่อนตอบ');
      if (
        await tx.facebookCommentReply.count({
          where: { threadId, status: { in: ['PENDING', 'UNKNOWN'] } },
        })
      )
        throw new ConflictException('ยังมีคำตอบที่รอยืนยันผลการส่ง กรุณาตรวจที่ Meta ก่อนส่งซ้ำ');
      const row = await tx.facebookCommentReply.create({
        data: {
          threadId,
          pageId: current.pageId,
          authorId: actor.id,
          requestKey,
          text,
          inboundSequence: current.inboundSequence,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'FACEBOOK_COMMENT_REPLY_ATTEMPT',
          entity: 'FacebookCommentReply',
          entityId: row.id,
          newValue: { threadId, status: row.status },
        },
      });
      return { row, created: true };
    });
    if (!prepared.created) return prepared.row;
    // Provider dispatch happens only after the durable attempt commits. There is no hidden retry.
    const result = await this.client.replyPublic({
      pageId: prepared.row.pageId,
      commentId: thread.rootCommentId,
      text,
    });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM facebook_comment_threads WHERE id = ${threadId} FOR UPDATE`;
      return this.finish(tx, prepared.row.id, result);
    });
  }
  private sameRequest(row: FacebookCommentReply, threadId: string, text: string) {
    if (row.threadId !== threadId || row.text !== text)
      throw new ConflictException('รหัสคำขอนี้ใช้กับคำตอบอื่นแล้ว กรุณาตรวจคำตอบเดิมก่อน');
    // With no external ID there is no safe provider lookup to prove a timeout. Keep UNKNOWN/PENDING.
    return row;
  }
  private async finish(
    tx: Prisma.TransactionClient,
    id: string,
    result: FacebookCommentSendResult,
  ) {
    const before = await tx.facebookCommentReply.findUniqueOrThrow({ where: { id } });
    if (before.status === 'CONFIRMED') return before;
    const row = await tx.facebookCommentReply.update({
      where: { id },
      data: {
        status: result.status,
        errorCode: result.status === 'CONFIRMED' ? null : result.errorCode,
        ...(result.status === 'CONFIRMED'
          ? { externalId: result.externalId, confirmedAt: new Date() }
          : {}),
      },
    });
    if (row.status === 'CONFIRMED') {
      // A later inbound revision is a new unanswered question, even if this older send is confirmed.
      await tx.facebookCommentThread.updateMany({
        where: {
          id: row.threadId,
          inboundSequence: row.inboundSequence,
          rootDeleted: false,
          status: { not: 'RESOLVED' },
        },
        data: { status: 'RESPONDED', waitingSince: null, revision: { increment: 1 } },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: row.authorId,
        action: `FACEBOOK_COMMENT_REPLY_${row.status}`,
        entity: 'FacebookCommentReply',
        entityId: row.id,
        oldValue: { status: before.status },
        newValue: { status: row.status, externalId: row.externalId, errorCode: row.errorCode },
      },
    });
    return row;
  }
  async reconcile(
    id: string,
    input: { externalId: string; reason: string },
    actor: ChatWorkActor,
    scope: WorkScope,
  ) {
    if (
      !input.externalId?.trim() ||
      input.externalId.length > 256 ||
      !input.reason?.trim() ||
      input.reason.length > 1000
    )
      throw new BadRequestException('กรุณาระบุคำตอบที่ตรวจพบและเหตุผล');
    const row = await this.prisma.facebookCommentReply.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ไม่พบคำตอบ');
    const { thread } = await this.work.assertThread(row.threadId, actor, scope);
    const proof = await this.client.readReply(row.pageId, input.externalId.trim());
    if (
      !proof ||
      proof.parentCommentId !== thread.rootCommentId ||
      proof.text !== row.text ||
      Date.parse(proof.createdAt) < Math.floor(row.attemptedAt.getTime() / 1000) * 1000
    )
      throw new ConflictException('ยังไม่มีหลักฐานคำตอบที่ตรงกันจาก Meta จึงยังยืนยันการส่งไม่ได้');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM facebook_comment_threads WHERE id = ${row.threadId} FOR UPDATE`;
      await this.work.assertThread(row.threadId, actor, scope, tx);
      const current = await tx.facebookCommentReply.findUniqueOrThrow({ where: { id } });
      if (current.status === 'CONFIRMED') {
        if (current.externalId !== proof.externalId)
          throw new ConflictException('คำตอบนี้ถูกยืนยันเป็นรายการอื่นแล้ว');
        return current;
      }
      if (!['PENDING', 'UNKNOWN'].includes(current.status))
        throw new ConflictException('คำตอบนี้ไม่ได้อยู่ระหว่างรอยืนยัน');
      const confirmed = await this.finish(tx, id, {
        status: 'CONFIRMED',
        externalId: proof.externalId,
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'FACEBOOK_COMMENT_REPLY_RECONCILED',
          entity: 'FacebookCommentReply',
          entityId: id,
          newValue: { externalId: proof.externalId, reason: input.reason.trim() },
        },
      });
      return confirmed;
    });
  }
}
