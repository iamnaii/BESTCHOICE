import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
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
   * Claim an event id before processing it (one INSERT — the UNIQUE index decides, so two
   * concurrent requests on different connections cannot both win).
   * `claimed` = first delivery, process it · `duplicate` = already claimed, skip it.
   * Any other failure is thrown so the caller decides what a database problem means
   * (Facebook Messenger fails open — Task 37; LINE uses `isDuplicate`, which fails closed).
   */
  async claim(eventId: string): Promise<'claimed' | 'duplicate'> {
    try {
      await this.prisma.processedWebhookEvent.create({ data: { eventId } });
      return 'claimed';
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'P2002') return 'duplicate';
      throw err;
    }
  }

  /**
   * Returns true if this eventId was already processed (duplicate).
   * Returns false and records the eventId if it's new.
   * Any failure counts as a duplicate (LINE — unchanged).
   */
  async isDuplicate(eventId: string): Promise<boolean> {
    try {
      return (await this.claim(eventId)) === 'duplicate';
    } catch {
      return true;
    }
  }

  /**
   * Retention: delete processed events older than 7 days.
   * LINE retries within seconds; Meta stops retrying a failing Messenger webhook within about
   * an hour (it then disables the subscription) — so 7 days is extremely safe for both.
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
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'webhook-dedup-cleanup' } });
    }
  }
}
