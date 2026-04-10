import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * DB-based webhook dedup — safe for multi-instance Cloud Run.
 * Uses unique constraint on eventId to prevent duplicate processing.
 * Includes retention cron to clean up old records.
 */
@Injectable()
export class WebhookDedupService {
  private readonly logger = new Logger(WebhookDedupService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Returns true if this eventId was already processed (duplicate).
   * Returns false and records the eventId if it's new.
   */
  async isDuplicate(eventId: string): Promise<boolean> {
    try {
      await this.prisma.processedWebhookEvent.create({
        data: { eventId },
      });
      return false; // new event
    } catch {
      // Unique constraint violation → already processed
      return true;
    }
  }

  /**
   * Retention: delete processed events older than 7 days.
   * LINE retries within seconds, so 7 days is extremely safe.
   * Runs daily at 4 AM.
   */
  @Cron('0 4 * * *', { timeZone: 'Asia/Bangkok' })
  async cleanupOldEvents(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    try {
      const { count } = await this.prisma.processedWebhookEvent.deleteMany({
        where: { processedAt: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(`[WebhookDedup] Cleaned up ${count} old events`);
      }
    } catch (err) {
      this.logger.error(`[WebhookDedup] Cleanup error: ${err instanceof Error ? err.message : err}`);
    }
  }
}
