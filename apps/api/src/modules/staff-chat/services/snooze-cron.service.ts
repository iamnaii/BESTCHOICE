import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import * as Sentry from '@sentry/nestjs';

/**
 * SnoozeCronService — fires snooze reminders every minute.
 *
 * Checks for ChatSnooze records where remindAt <= now and completed = false,
 * marks them as completed so downstream consumers (WebSocket, push, etc.)
 * can notify the staff member.
 */
@Injectable()
export class SnoozeCronService {
  private readonly logger = new Logger(SnoozeCronService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Check for due snooze reminders — every minute.
   */
  @Cron('* * * * *', { timeZone: 'Asia/Bangkok' })
  async checkReminders(): Promise<void> {
    try {
      const now = new Date();

      // Find all due, uncompleted snoozes
      const dueSnoozes = await this.prisma.chatSnooze.findMany({
        where: {
          remindAt: { lte: now },
          completed: false,
        },
        select: {
          id: true,
          sessionId: true,
          staffId: true,
          note: true,
        },
      });

      if (dueSnoozes.length === 0) {
        this.logger.debug('[Snooze] No due reminders');
        return;
      }

      // Mark all due snoozes as completed
      await this.prisma.chatSnooze.updateMany({
        where: {
          id: { in: dueSnoozes.map((s) => s.id) },
        },
        data: { completed: true },
      });

      this.logger.log(`[Snooze] Fired ${dueSnoozes.length} reminder(s)`);
    } catch (error) {
      this.logger.error('[Snooze] Failed to check reminders', error);
      Sentry.captureException(error);
    }
  }
}
