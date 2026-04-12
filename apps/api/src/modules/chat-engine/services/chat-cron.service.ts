import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatSessionStatus } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';

@Injectable()
export class ChatCronService {
  private readonly logger = new Logger(ChatCronService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * SLA breach check — every 5 minutes
   * Finds sessions that have not received a first response within 5 minutes.
   */
  @Cron('*/5 * * * *', { timeZone: 'Asia/Bangkok' })
  async checkSlaBreaches(): Promise<void> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      const breachedSessions = await this.prisma.chatSession.findMany({
        where: {
          sessionStatus: { in: [ChatSessionStatus.OPEN, ChatSessionStatus.HANDOFF] },
          firstResponseAt: null,
          createdAt: { lt: fiveMinutesAgo },
          deletedAt: null,
        },
        select: { id: true, channel: true, createdAt: true },
      });

      const count = breachedSessions.length;

      if (count > 0) {
        this.logger.warn(`SLA breach: ${count} session(s) without first response after 5 minutes`);
        Sentry.addBreadcrumb({
          category: 'chat-sla',
          message: `${count} SLA breach(es) detected`,
          level: 'warning',
          data: { count, sessionIds: breachedSessions.map((s) => s.id).slice(0, 10) },
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
   * Auto-resolve idle sessions — every hour
   * Resolves sessions with no messages in the last 24 hours.
   */
  @Cron('0 */1 * * *', { timeZone: 'Asia/Bangkok' })
  async autoResolveIdleSessions(): Promise<void> {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const now = new Date();

      const result = await this.prisma.chatSession.updateMany({
        where: {
          sessionStatus: { in: [ChatSessionStatus.OPEN, ChatSessionStatus.PENDING] },
          lastMessageAt: { lt: twentyFourHoursAgo },
          deletedAt: null,
        },
        data: {
          sessionStatus: ChatSessionStatus.RESOLVED,
          resolvedAt: now,
        },
      });

      if (result.count > 0) {
        this.logger.log(`Auto-resolved ${result.count} idle session(s)`);
      } else {
        this.logger.debug('Auto-resolve: no idle sessions found');
      }
    } catch (error) {
      this.logger.error('Failed to auto-resolve idle sessions', error);
      Sentry.captureException(error);
    }
  }
}
