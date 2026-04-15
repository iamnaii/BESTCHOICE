import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatRoomStatus } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';

@Injectable()
export class ChatCronService {
  private readonly logger = new Logger(ChatCronService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * SLA breach check — every 5 minutes
   * Finds rooms that have not received a first response within 5 minutes.
   */
  @Cron('*/5 * * * *', { timeZone: 'Asia/Bangkok' })
  async checkSlaBreaches(): Promise<void> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      const breachedRooms = await this.prisma.chatRoom.findMany({
        where: {
          status: ChatRoomStatus.ACTIVE,
          firstResponseAt: null,
          createdAt: { lt: fiveMinutesAgo },
          deletedAt: null,
        },
        select: { id: true, channel: true, createdAt: true },
      });

      const count = breachedRooms.length;

      if (count > 0) {
        this.logger.warn(`SLA breach: ${count} room(s) without first response after 5 minutes`);
        Sentry.addBreadcrumb({
          category: 'chat-sla',
          message: `${count} SLA breach(es) detected`,
          level: 'warning',
          data: { count, roomIds: breachedRooms.map((r) => r.id).slice(0, 10) },
        });
      } else {
        this.logger.debug('SLA check: no breaches found');
      }
    } catch (error) {
      this.logger.error('Failed to check SLA breaches', error);
      Sentry.captureException(error);
    }
  }

  /**
   * Mark idle rooms — every hour
   * Marks ACTIVE rooms with no messages in the last 24 hours as IDLE.
   * Rooms are never destroyed — they stay around and will be reopened
   * to ACTIVE automatically when the customer sends a new message.
   */
  @Cron('0 */1 * * *', { timeZone: 'Asia/Bangkok' })
  async markIdleRooms(): Promise<void> {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const now = new Date();

      const result = await this.prisma.chatRoom.updateMany({
        where: {
          status: ChatRoomStatus.ACTIVE,
          handoffMode: false,
          lastMessageAt: { lt: twentyFourHoursAgo },
          deletedAt: null,
        },
        data: {
          status: ChatRoomStatus.IDLE,
          resolvedAt: now,
        },
      });

      if (result.count > 0) {
        this.logger.log(`Marked ${result.count} idle room(s) as IDLE`);
      } else {
        this.logger.debug('Idle check: no rooms to mark idle');
      }
    } catch (error) {
      this.logger.error('Failed to mark idle rooms', error);
      Sentry.captureException(error);
    }
  }
}
