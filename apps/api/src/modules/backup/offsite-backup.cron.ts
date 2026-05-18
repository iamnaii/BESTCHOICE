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

  /**
   * W5 fix: emit a boot log line confirming the scheduler resolved the
   * Asia/Bangkok zone. On node:20-alpine without `tzdata` installed,
   * @nestjs/schedule silently falls back to UTC — this log lets ops
   * verify the next planned tick during deploy smoke.
   */
  onModuleInit(): void {
    const now = new Date();
    const bkk = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    this.logger.log(
      `OffsiteBackupCron scheduled '30 3 * * *' in Asia/Bangkok (current BKK: ${bkk}, UTC: ${now.toISOString()})`,
    );
  }

  @Cron('30 3 * * *', { timeZone: 'Asia/Bangkok' })
  async handleDaily(): Promise<void> {
    try {
      const result = await this.service.run({ triggeredBy: 'cron' });
      this.logger.log(
        `offsite-backup cron tick: ${result.status} — ${result.filesCount} files / ${result.totalBytes}B / ${result.durationMs}ms`,
      );
    } catch (err) {
      // The service itself already captures per-step errors. This is a
      // last-ditch catch for an unexpected throw at the service boundary
      // (e.g. PrismaClient unavailable, or another pod holds the advisory
      // lock — ConflictException is expected when the cron + a manual run
      // overlap; log it as a warning rather than an error).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (err as any)?.status;
      if (status === 409) {
        this.logger.warn(
          `offsite-backup cron: skipped tick — another run is already in progress`,
        );
        return;
      }
      this.logger.error(
        `offsite-backup cron failed unexpectedly: ${(err as Error).message}`,
      );
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'offsite-backup' } });
    }
  }
}
