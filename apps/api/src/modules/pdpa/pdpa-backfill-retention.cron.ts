import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PdpaEncryptionService } from './pdpa-encryption.service';

/**
 * Phase 3 SP4 — DEEP review W2 — PdpaBackfillRun retention cron.
 *
 * Hard-deletes PdpaBackfillRun rows older than 1 year. Matches AuditLog
 * + OffsiteBackupRun retention policy and the model's "append-only event
 * log" exception in database.md.
 *
 * The schema-level comment on `PdpaBackfillRun` promises a retention job —
 * this is that job. Without it, the table grows unbounded (~1 row per
 * backfill, but historical UUIDs of triggering OWNER users linger after
 * those users are soft-deleted → PDPA risk).
 *
 * Schedule: 02:00 BKK daily — sits between AuditRetentionCron
 * (Sun 03:00) and OffsiteBackupCron (03:30), no scheduler contention.
 * Same time as OffsiteBackupRetentionCron — both are tiny deletes so
 * stacking is fine.
 */
@Injectable()
export class PdpaBackfillRetentionCron {
  private readonly logger = new Logger(PdpaBackfillRetentionCron.name);
  static readonly RETENTION_DAYS = 365;

  constructor(private readonly service: PdpaEncryptionService) {}

  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async pruneOldRuns(): Promise<{ pruned: number }> {
    try {
      const pruned = await this.service.pruneOldRuns(
        PdpaBackfillRetentionCron.RETENTION_DAYS,
      );
      if (pruned > 0) {
        Sentry.captureMessage(`pdpa-backfill retention pruned ${pruned} row(s)`, {
          level: 'info',
          tags: { kind: 'cron-job', cron: 'pdpa-backfill-retention' },
          extra: { pruned, retentionDays: PdpaBackfillRetentionCron.RETENTION_DAYS },
        });
      }
      return { pruned };
    } catch (err) {
      this.logger.error(
        `pdpa-backfill retention failed: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'pdpa-backfill-retention' },
      });
      return { pruned: 0 };
    }
  }
}
