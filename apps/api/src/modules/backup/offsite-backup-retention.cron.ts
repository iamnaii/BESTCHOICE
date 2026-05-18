import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { OffsiteBackupService } from './offsite-backup.service';

/**
 * Phase 3 SP2 — DEEP review C3 — OffsiteBackupRun retention cron.
 *
 * Hard-deletes OffsiteBackupRun rows older than 1 year. Matches AuditLog
 * retention policy + the model's "append-only event log" exception in
 * database.md.
 *
 * Why this matters:
 *   - Without retention the table grows ~30 rows/month — small per-month
 *     but stale rows accumulate user UUIDs (PDPA-risk after the user is
 *     soft-deleted).
 *   - The original SP2 runbook claimed "stays small forever, no retention
 *     cron". Fix Report v1.0 corrected the claim — see OFFSITE-BACKUP.md §9.
 *
 * Schedule: 02:00 BKK daily. Sits between AuditRetentionCron (Sun 03:00)
 * and OffsiteBackupCron (03:30) so no scheduler contention.
 */
@Injectable()
export class OffsiteBackupRetentionCron {
  private readonly logger = new Logger(OffsiteBackupRetentionCron.name);
  static readonly RETENTION_DAYS = 365;

  constructor(private readonly service: OffsiteBackupService) {}

  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async pruneOldRuns(): Promise<{ pruned: number }> {
    try {
      const pruned = await this.service.pruneOldRuns(
        OffsiteBackupRetentionCron.RETENTION_DAYS,
      );
      if (pruned > 0) {
        Sentry.captureMessage(`offsite-backup retention pruned ${pruned} row(s)`, {
          level: 'info',
          tags: { kind: 'cron-job', cron: 'offsite-backup-retention' },
          extra: { pruned, retentionDays: OffsiteBackupRetentionCron.RETENTION_DAYS },
        });
      }
      return { pruned };
    } catch (err) {
      this.logger.error(
        `offsite-backup retention failed: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'offsite-backup-retention' },
      });
      return { pruned: 0 };
    }
  }
}
