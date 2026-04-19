import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * T2-C13 — weekly sweep of the main AuditLog.
 *
 * The AuditLog table carries the legal audit trail (who did what, when).
 * The BEFORE DELETE trigger installed by 20260520300000_audit_log_archive_immutable
 * refuses physical DELETEs, so we *archive* instead: set archived_at on any
 * row older than AUDIT_LOG_RETENTION_DAYS.
 *
 * Archived rows remain queryable for forensics but fall outside the hot
 * reporting set. A separate purge path (not this cron) can later hard-cull
 * archived rows beyond the 7-year legal retention.
 *
 * Schedule: Sunday 03:00 Asia/Bangkok. Lines up after the audit-chain-verify
 * cron at 03:45 on other days, avoiding lock contention.
 */
@Injectable()
export class AuditRetentionCron {
  private readonly logger = new Logger(AuditRetentionCron.name);
  static readonly DEFAULT_RETENTION_DAYS = 180;

  constructor(private readonly prisma: PrismaService) {}

  private getRetentionDays(): number {
    const raw = process.env.AUDIT_LOG_RETENTION_DAYS;
    if (!raw) return AuditRetentionCron.DEFAULT_RETENTION_DAYS;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return AuditRetentionCron.DEFAULT_RETENTION_DAYS;
    return n;
  }

  @Cron('0 3 * * 0', { timeZone: 'Asia/Bangkok' })
  async archiveOldEntries(): Promise<{ archived: number; retentionDays: number }> {
    const retentionDays = this.getRetentionDays();
    try {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      // Soft-archive only: the BEFORE DELETE trigger (T2-C4 ext) refuses
      // physical deletes on audit_logs. UPDATE archived_at is the policy-
      // compliant path.
      const result = await this.prisma.auditLog.updateMany({
        where: {
          createdAt: { lt: cutoff },
          archivedAt: null,
        },
        data: { archivedAt: new Date() },
      });

      if (result.count > 0) {
        this.logger.log(
          `AuditLog retention: archived ${result.count} row(s) older than ${retentionDays}d`,
        );
        Sentry.captureMessage(`AuditLog retention archived ${result.count} row(s)`, {
          level: 'info',
          tags: { kind: 'cron-job', cron: 'audit-retention' },
          extra: { archived: result.count, retentionDays },
        });
      } else {
        this.logger.log(`AuditLog retention: nothing older than ${retentionDays}d`);
      }
      return { archived: result.count, retentionDays };
    } catch (err) {
      this.logger.error(
        `Audit retention failed: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'audit-retention' },
      });
      return { archived: 0, retentionDays };
    }
  }
}
