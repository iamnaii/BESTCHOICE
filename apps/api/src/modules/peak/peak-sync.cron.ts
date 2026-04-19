import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PeakService } from './peak.service';

/**
 * Daily PEAK sync (T6-C8). Exports all POSTED journal entries from yesterday
 * into PEAK accounting system. Runs at 23:30 Asia/Bangkok — after business
 * hours but before midnight so entries for "today" aren't pulled into
 * tomorrow's batch.
 *
 * Idempotency: `exportJournalEntries` already filters `peakSyncedAt = null`,
 * so re-running the same window is safe.
 */
@Injectable()
export class PeakSyncCron {
  private readonly logger = new Logger(PeakSyncCron.name);

  constructor(private readonly peak: PeakService) {}

  @Cron('30 23 * * *', { timeZone: 'Asia/Bangkok' })
  async dailySync(): Promise<{ exported: number; errors: number }> {
    try {
      if (!(await this.peak.isConfigured())) {
        this.logger.log('PEAK not configured — skipping daily sync');
        return { exported: 0, errors: 0 };
      }

      // Range: yesterday 00:00 through today 23:30 (today window to catch
      // same-day posts up to now). PEAK syncedAt filter prevents duplicate
      // export — we can be generous with the range.
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date();

      const result = await this.peak.exportJournalEntries(start, end);
      this.logger.log(
        `PEAK daily sync: ${result.exported} exported, ${result.errors.length} errors`,
      );

      if (result.errors.length > 0) {
        Sentry.captureMessage(
          `PEAK daily sync had ${result.errors.length} errors (exported ${result.exported})`,
          {
            level: 'warning',
            tags: { kind: 'cron-job', cron: 'peak-sync' },
            extra: { errors: result.errors.slice(0, 20), exported: result.exported },
          },
        );
      }

      return { exported: result.exported, errors: result.errors.length };
    } catch (err) {
      this.logger.error(`PEAK sync cron failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'peak-sync' } });
      return { exported: 0, errors: 0 };
    }
  }
}
