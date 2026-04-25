import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { CustomerTagsService } from './customer-tags.service';

/**
 * Daily customer-tag recompute cron.
 *
 * Schedule: 18:00 UTC = 01:00 Asia/Bangkok the next day. Runs after the daily
 * collections cron pipeline (snapshots / dunning) so the tags reflect the
 * latest broken-promise data before the next workday begins.
 *
 * Failure path: log + Sentry, then rethrow so the next-run signal in metrics
 * is honest. Per-customer errors inside `recomputeAll` are caught locally so
 * one bad customer doesn't poison the whole batch.
 */
@Injectable()
export class CustomerTagRecomputeCron {
  private readonly logger = new Logger(CustomerTagRecomputeCron.name);

  constructor(private readonly service: CustomerTagsService) {}

  // Daily 01:00 Asia/Bangkok (UTC+7) → 18:00 UTC the day before.
  @Cron('0 18 * * *', { timeZone: 'Asia/Bangkok' })
  async runDaily(): Promise<{ processed: number; added: number; removed: number }> {
    try {
      const result = await this.service.recomputeAll();
      this.logger.log(
        `customer-tag-recompute processed=${result.processed} added=${result.added} removed=${result.removed}`,
      );
      Sentry.captureMessage(`customer-tag-recompute processed ${result.processed} customers`, {
        level: 'info',
        tags: { kind: 'cron-job', cron: 'customer-tag-recompute' },
        extra: result,
      });
      return result;
    } catch (err) {
      this.logger.error(
        `customer-tag-recompute failed: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'customer-tag-recompute' },
      });
      throw err;
    }
  }
}
