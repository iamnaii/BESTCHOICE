import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MessageRole, MessageType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';

/** Delivery runs after commit. A claim is never automatically reused after an uncertain send. */
@Injectable()
export class AppointmentConfirmationService {
  private readonly logger = new Logger(AppointmentConfirmationService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly router: MessageRouterService,
  ) {}

  @Cron('*/10 * * * * *', { waitForCompletion: true })
  async flush() {
    try {
      await this.db.appointmentConfirmation.updateMany({
        where: { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - 120_000) } },
        data: { status: 'UNKNOWN' },
      });
      const jobs = await this.db.appointmentConfirmation.findMany({
        where: { status: 'PENDING', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const job of jobs) await this.deliver(job.id);
    } catch {
      this.logger.error('Appointment confirmation worker failed; pending work remains queued');
    }
  }

  async deliver(id: string) {
    const candidate = await this.db.appointmentConfirmation.findUnique({ where: { id } });
    if (!candidate || candidate.status !== 'PENDING') return;
    const uncertain = await this.db.appointmentConfirmation.count({
      where: {
        appointmentId: candidate.appointmentId,
        version: { lt: candidate.version },
        status: { in: ['UNKNOWN', 'BLOCKED'] },
      },
    });
    if (uncertain) {
      await this.db.appointmentConfirmation.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'BLOCKED' },
      });
      return;
    }
    try {
      const claimed = await this.db.appointmentConfirmation.updateMany({
        where: {
          id,
          status: 'PENDING',
          deletedAt: null,
          appointment: {
            confirmations: { none: { status: { in: ['SENDING', 'UNKNOWN', 'BLOCKED'] } } },
          },
        },
        data: { status: 'SENDING', attempts: { increment: 1 } },
      });
      if (!claimed.count) return;
    } catch (error) {
      // A different version claimed this appointment concurrently. Its durable SENDING row owns delivery.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
    const finish = (status: string) =>
      this.db.appointmentConfirmation.update({ where: { id }, data: { status } });
    try {
      const job = await this.db.appointmentConfirmation.findUniqueOrThrow({
        where: { id },
        include: { appointment: true, room: true },
      });
      const newest = await this.db.appointmentConfirmation.findFirst({
        where: { appointmentId: job.appointmentId, deletedAt: null },
        orderBy: { version: 'desc' },
      });
      if (
        newest?.id !== id ||
        job.appointment.deletedAt ||
        (job.kind !== 'CANCELED' && !['BOOKED', 'CHECKED_IN'].includes(job.appointment.status))
      ) {
        await finish('SUPERSEDED');
        return;
      }
      const room = job.room;
      if (
        !room ||
        room.deletedAt ||
        room.customerId !== job.appointment.customerId ||
        !['LINE_SHOP', 'FACEBOOK'].includes(room.channel) ||
        room.channel !== job.channel ||
        (room.externalUserId || room.lineUserId) !== job.recipientId
      ) {
        await finish('NO_CHANNEL');
        return;
      }
      const adapter = this.router.getAdapter(room.channel);
      if (!adapter) {
        await finish('FAILED');
        return;
      }
      const clientMessageId = `appointment:${id}`;
      const message = await this.db.chatMessage.upsert({
        where: { roomId_clientMessageId: { roomId: room.id, clientMessageId } },
        create: {
          roomId: room.id,
          clientMessageId,
          role: MessageRole.BOT,
          type: MessageType.TEXT,
          text: job.text,
          intent: 'APPOINTMENT_CONFIRMATION',
        },
        update: {},
      });
      if (message.outboundSentAt) {
        await this.db.appointmentConfirmation.update({
          where: { id },
          data: { status: 'SENT', sentAt: message.outboundSentAt },
        });
        return;
      }
      const result = await adapter.sendMessage({
        automated: true,
        externalUserId: job.recipientId!,
        channel: room.channel,
        type: MessageType.TEXT,
        text: job.text,
      });
      if (!result.success || result.droppedReason) {
        await finish(result.definitelyNotSent || result.droppedReason ? 'FAILED' : 'UNKNOWN');
        return;
      }
      const sentAt = new Date();
      // Do not claim the room, pause AI, clear waiting, or count this as a human reply.
      await this.db.$transaction(async (tx) => {
        await tx.chatMessage.update({
          where: { id: message.id },
          data: { outboundSentAt: sentAt },
        });
        await tx.appointmentConfirmation.update({
          where: { id },
          data: { status: 'SENT', sentAt },
        });
      });
      if (result.externalMessageId)
        await this.db.chatMessage
          .updateMany({
            where: { id: message.id },
            data: { externalMessageId: result.externalMessageId },
          })
          .catch(() => undefined);
    } catch {
      // Network errors or a process crash may have delivered the message. Do not duplicate it.
      await finish('UNKNOWN');
    }
  }
}
