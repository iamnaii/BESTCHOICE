import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { OffsiteBackupService } from './offsite-backup.service';

/**
 * Phase 3 SP2 — off-site backup cron.
 *
 * Runs daily at 03:30 Asia/Bangkok. Cloud SQL automated backups finish
 * around 03:00 BKK, so 03:30 gives the export pipeline ~30 minutes to
 * land the daily dump file before we try to replicate it.
 *
 * The actual replication logic lives in OffsiteBackupService. This cron
 * is intentionally tiny — it just forwards to the service with
 * `triggeredBy: 'cron'` and forwards exceptions to Sentry. The service
 * already records a SKIPPED OffsiteBackupRun row when the toggle is off,
 * so the cron never reads SystemConfig directly.
 */
@Injectable()
export class OffsiteBackupCron {
  private readonly logger = new Logger(OffsiteBackupCron.name);

  constructor(private readonly service: OffsiteBackupService) {}

  @Cron('30 3 * * *', { timeZone: 'Asia/Bangkok' })
  async handleDaily(): Promise<void> {
    try {
      const result = await this.service.run('cron');
      this.logger.log(
        `offsite-backup cron tick: ${result.status} — ${result.filesCount} files / ${result.totalBytes}B / ${result.durationMs}ms`,
      );
    } catch (err) {
      // The service itself already captures per-step errors. This is a
      // last-ditch catch for an unexpected throw at the service boundary
      // (e.g. PrismaClient unavailable). Never crash the scheduler.
      this.logger.error(
        `offsite-backup cron failed unexpectedly: ${(err as Error).message}`,
      );
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'offsite-backup' } });
    }
  }
}
