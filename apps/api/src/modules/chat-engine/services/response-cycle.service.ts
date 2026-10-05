import { policyVersion, readCurrentSlaPolicy, readAlertGate } from './chat-sla-policy';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ResponseCycleService {
  constructor(private readonly prisma: PrismaService) {}

  async enabled(tx: Prisma.TransactionClient = this.prisma) {
    return (
      (
        await tx.systemConfig.findFirst({
          where: { key: 'chat_work_queue_enabled', deletedAt: null },
        })
      )?.value === 'true'
    );
  }
  async lock(tx: Prisma.TransactionClient, roomId: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM chat_rooms WHERE id = ${roomId} AND deleted_at IS NULL FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('ไม่พบห้องแชท');
  }
  async openInTx(
    tx: Prisma.TransactionClient,
    input: { roomId: string; messageId: string; receivedAt: Date },
  ) {
    await this.lock(tx, input.roomId);
    const room = await tx.chatRoom.findUniqueOrThrow({ where: { id: input.roomId } });
    const message = await tx.chatMessage.findFirst({
      where: { id: input.messageId, roomId: input.roomId, role: 'CUSTOMER' },
    });
    if (!message) throw new NotFoundException('ไม่พบข้อความลูกค้า');
    if (message.inboundSequence === null) {
      const updated = await tx.chatRoom.update({
        where: { id: room.id },
        data: { inboundSequence: { increment: 1 } },
      });
      await tx.chatMessage.update({
        where: { id: message.id },
        data: { inboundSequence: updated.inboundSequence },
      });
    }
    const existing = await tx.chatResponseCycle.findFirst({
      where: { roomId: room.id, endedAt: null },
    });
    if (!existing) {
      const legacy = room.waitingSince && room.waitingSince < input.receivedAt;
      const policy = await readCurrentSlaPolicy(tx);
      await tx.chatResponseCycle.create({
        data: {
          roomId: room.id,
          startedAt: legacy ? room.waitingSince! : input.receivedAt,
          firstCustomerMessageId: legacy ? null : message.id,
          assignedAtOpenId: room.assignedToId,
          origin: legacy ? 'LEGACY_OPEN' : 'LIVE',
          policyVersion: policyVersion(policy),
          alertEligibleAt: input.receivedAt,
        },
      });
    } else if (!existing.alertEligibleAt || existing.alertEligibleAt < (await readAlertGate(tx)).cutover) {
      await tx.chatResponseCycle.update({
        where: { id: existing.id },
        data: { alertEligibleAt: input.receivedAt },
      });
    }
    await tx.chatRoom.updateMany({
      where: { id: room.id, waitingSince: null },
      data: { waitingSince: input.receivedAt },
    });
  }
  async recordBotSentInTx(tx: Prisma.TransactionClient, input: { roomId: string; sentAt: Date }) {
    await this.lock(tx, input.roomId);
    await tx.chatResponseCycle.updateMany({
      where: {
        roomId: input.roomId,
        endedAt: null,
        firstBotSentAt: null,
        startedAt: { lte: input.sentAt },
      },
      data: { firstBotSentAt: input.sentAt },
    });
  }
  /** Claim delivery before calling the provider. Never hold a database transaction over network I/O. */
  async prepareAttempt(messageId: string, forceDeliveryTracking = false): Promise<boolean> {
    const trackCycles = await this.enabled();
    if (!trackCycles && !forceDeliveryTracking) return true;
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.chatMessage.findUniqueOrThrow({ where: { id: messageId } });
      await this.lock(tx, before.roomId);
      const message = await tx.chatMessage.findUniqueOrThrow({ where: { id: messageId } });
      if (
        message.outboundSentAt ||
        (message.outboundAttemptState && message.outboundAttemptState !== 'FAILED')
      )
        return false;
      if (!trackCycles) {
        await tx.chatMessage.update({ where: { id: message.id }, data: { outboundAttemptAt: new Date(), outboundAttemptState: 'SENDING' } });
        return true;
      }
      await this.seedLegacyInTx(tx, message.roomId);
      const room = await tx.chatRoom.findUniqueOrThrow({ where: { id: message.roomId } });
      const cycle = await tx.chatResponseCycle.findFirst({
        where: { roomId: message.roomId, endedAt: null },
      });
      const last = await tx.chatMessage.findFirst({
        where: { roomId: message.roomId, role: 'CUSTOMER', inboundSequence: { not: null } },
        orderBy: { inboundSequence: 'desc' },
      });
      await tx.chatMessage.update({
        where: { id: message.id },
        data: {
          cycleId: cycle?.id ?? null,
          answeredThroughMessageId: last?.id ?? null,
          answeredThroughSequence: room.inboundSequence,
          outboundAttemptAt: new Date(),
          outboundAttemptState: 'SENDING',
        },
      });
      return true;
    });
  }
  async failAttempt(messageId: string, definitelyNotSent: boolean, forceDeliveryTracking = false) {
    if (!forceDeliveryTracking && !(await this.enabled())) return;
    await this.prisma.chatMessage.updateMany({
      where: { id: messageId, outboundSentAt: null },
      data: { outboundAttemptState: definitelyNotSent ? 'FAILED' : 'UNKNOWN' },
    });
  }
  async closeHumanInTx(
    tx: Prisma.TransactionClient,
    input: {
      roomId: string;
      cycleId: string | null;
      messageId: string;
      answeredThroughMessageId: string | null;
      staffId: string | null;
      sentAt: Date;
    },
  ) {
    await this.lock(tx, input.roomId);
    if (!input.cycleId) return;
    const cycle = await tx.chatResponseCycle.findFirst({
      where: { id: input.cycleId, roomId: input.roomId, endedAt: null },
    });
    const outbound = await tx.chatMessage.findFirst({
      where: { id: input.messageId, roomId: input.roomId, cycleId: input.cycleId },
    });
    if (!cycle || outbound?.answeredThroughSequence == null) return;
    const changed = await tx.chatResponseCycle.updateMany({
      where: { id: cycle.id, endedAt: null },
      data: {
        endedAt: input.sentAt,
        endReason: 'HUMAN_REPLY',
        firstHumanSentAt: input.sentAt,
        firstHumanStaffId: input.staffId,
      },
    });
    if (!changed.count) return;
    const unanswered = await tx.chatMessage.findFirst({
      where: {
        roomId: input.roomId,
        role: 'CUSTOMER',
        inboundSequence: { gt: outbound.answeredThroughSequence },
      },
      orderBy: { inboundSequence: 'asc' },
    });
    await tx.chatRoom.update({ where: { id: input.roomId }, data: { waitingSince: null } });
    if (unanswered)
      await this.openInTx(tx, {
        roomId: input.roomId,
        messageId: unanswered.id,
        receivedAt: unanswered.createdAt,
      });
  }
  async confirm(messageId: string, externalMessageId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.chatMessage.findUniqueOrThrow({ where: { id: messageId } });
      await this.lock(tx, before.roomId);
      const message = await tx.chatMessage.findUniqueOrThrow({ where: { id: messageId } });
      if (message.outboundSentAt) return;
      const sentAt = new Date();
      if (externalMessageId) {
        const echo = await tx.chatMessage.findUnique({ where: { externalMessageId } });
        if (echo && echo.id !== message.id) {
          if (echo.roomId !== message.roomId || echo.role === 'CUSTOMER' || echo.clientMessageId)
            throw new ConflictException('ยืนยันข้อความจากผู้ให้บริการไม่ได้');
          await tx.chatMessage.update({
            where: { id: echo.id },
            data: { externalMessageId: null, deletedAt: sentAt },
          });
          await tx.chatRoom.update({
            where: { id: message.roomId },
            data: { totalMessages: { decrement: 1 } },
          });
        }
      }
      await tx.chatMessage.update({
        where: { id: message.id },
        data: {
          outboundSentAt: sentAt,
          outboundAttemptState: 'CONFIRMED',
          ...(externalMessageId ? { externalMessageId } : {}),
        },
      });
      if (message.role === 'BOT')
        await this.recordBotSentInTx(tx, { roomId: message.roomId, sentAt });
      if (message.role === 'STAFF')
        await this.closeHumanInTx(tx, {
          roomId: message.roomId,
          cycleId: message.cycleId,
          messageId,
          answeredThroughMessageId: message.answeredThroughMessageId,
          staffId: message.staffId,
          sentAt,
        });
    });
  }
  /** Echo proves delivery, but no verified inbound watermark means it cannot close work by inference. */
  async confirmUnknownEcho(messageId: string) {
    await this.prisma.$transaction(async (tx) => {
      const message = await tx.chatMessage.findUniqueOrThrow({ where: { id: messageId } });
      await this.lock(tx, message.roomId);
      const sentAt = new Date();
      await tx.chatMessage.updateMany({
        where: { id: messageId, outboundSentAt: null },
        data: { outboundSentAt: sentAt, outboundAttemptState: 'CONFIRMED' },
      });
      if (message.role === 'BOT')
        await this.recordBotSentInTx(tx, { roomId: message.roomId, sentAt });
    });
  }
  async resolveInTx(tx: Prisma.TransactionClient, input: { roomId: string; resolvedAt: Date }) {
    await this.lock(tx, input.roomId);
    await tx.chatResponseCycle.updateMany({
      where: { roomId: input.roomId, endedAt: null },
      data: { endedAt: input.resolvedAt, endReason: 'RESOLVED' },
    });
    await tx.chatRoom.update({ where: { id: input.roomId }, data: { waitingSince: null } });
  }
  async auditOpenWaits() {
    const [result] = await this.prisma.$queryRaw<Array<{ mismatched: bigint; untracked: bigint }>>`
      SELECT
        (SELECT count(*) FROM chat_response_cycles c JOIN chat_rooms r ON r.id = c.room_id
          WHERE c.ended_at IS NULL AND c.deleted_at IS NULL AND r.deleted_at IS NULL
          AND c.started_at IS DISTINCT FROM r.waiting_since) AS mismatched,
        (SELECT count(*) FROM chat_rooms r WHERE r.deleted_at IS NULL AND r.waiting_since IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM chat_response_cycles c WHERE c.room_id = r.id AND c.ended_at IS NULL)) AS untracked`;
    return { mismatched: Number(result.mismatched), untracked: Number(result.untracked) };
  }

  async seedLegacy(dryRun = true) {
    const where: Prisma.ChatRoomWhereInput = {
      deletedAt: null,
      waitingSince: { not: null },
      responseCycles: { none: { endedAt: null } },
    };
    const pending = await this.prisma.chatRoom.count({ where });
    if (dryRun) return { pending, processed: 0, dryRun: true };
    let cursor: string | undefined;
    let processed = 0;
    for (;;) {
      const rooms = await this.prisma.chatRoom.findMany({
        where: { AND: [where, ...(cursor ? [{ id: { gt: cursor } }] : [])] },
        orderBy: { id: 'asc' },
        take: 200,
        select: { id: true },
      });
      if (!rooms.length) break;
      for (const room of rooms) {
        await this.prisma.$transaction((tx) => this.seedLegacyInTx(tx, room.id));
        processed++;
      }
      cursor = rooms[rooms.length - 1].id;
    }
    return { pending, processed, dryRun: false };
  }
  async seedLegacyInTx(tx: Prisma.TransactionClient, roomId: string) {
    await this.lock(tx, roomId);
    const room = await tx.chatRoom.findUniqueOrThrow({ where: { id: roomId } });
    if (
      !room.waitingSince ||
      (await tx.chatResponseCycle.count({ where: { roomId, endedAt: null } }))
    )
      return;
    await tx.chatResponseCycle.create({
      data: {
        roomId,
        startedAt: room.waitingSince,
        origin: 'LEGACY_OPEN',
        policyVersion: 'legacy',
        assignedAtOpenId: room.assignedToId,
      },
    });
  }
  async mergeInTx(tx: Prisma.TransactionClient, primaryId: string, secondaryId: string) {
    for (const id of [primaryId, secondaryId].sort()) await this.lock(tx, id);
    await this.seedLegacyInTx(tx, primaryId);
    await this.seedLegacyInTx(tx, secondaryId);
    const open = await tx.chatResponseCycle.findMany({
      where: { roomId: { in: [primaryId, secondaryId] }, endedAt: null },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });
    // In-flight replies were composed before the merge: never infer that they answer both conversations.
    await tx.chatMessage.updateMany({
      where: { roomId: { in: [primaryId, secondaryId] }, outboundSentAt: null },
      data: { cycleId: null, answeredThroughMessageId: null, answeredThroughSequence: null },
    });
    if (open.length) {
      const keep = open[0];
      await tx.chatResponseCycle.updateMany({
        where: { id: { in: open.slice(1).map((cycle) => cycle.id) } },
        data: { endedAt: new Date(), endReason: 'MERGED', mergedIntoId: keep.id },
      });
      await tx.chatResponseCycle.updateMany({
        where: { roomId: secondaryId },
        data: { roomId: primaryId },
      });
    } else {
      await tx.chatResponseCycle.updateMany({
        where: { roomId: secondaryId },
        data: { roomId: primaryId },
      });
    }
    // Sequence numbers only define order inside a room; rebuild them before moving messages.
    const inbound = await tx.chatMessage.findMany({
      where: { roomId: { in: [primaryId, secondaryId] }, role: 'CUSTOMER' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    for (let i = 0; i < inbound.length; i++)
      await tx.chatMessage.update({
        where: { id: inbound[i].id },
        data: { inboundSequence: i + 1 },
      });
    await tx.chatRoom.update({
      where: { id: primaryId },
      data: { inboundSequence: inbound.length },
    });
    await tx.todo.updateMany({ where: { roomId: secondaryId }, data: { roomId: primaryId } });
    await tx.staffInboxItem.updateMany({
      where: { roomId: secondaryId, targetType: 'ROOM' },
      data: { roomId: primaryId, targetId: primaryId },
    });
    await tx.staffInboxItem.updateMany({
      where: { roomId: secondaryId },
      data: { roomId: primaryId },
    });
  }
}
