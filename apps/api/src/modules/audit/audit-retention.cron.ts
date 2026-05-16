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
 * row older than the configured retention.
 *
 * Archived rows remain queryable for forensics but fall outside the hot
 * reporting set. A separate purge path (not this cron) can later hard-cull
 * archived rows beyond the legal retention.
 *
 * **D1.4.3.1 (2026-05-16):** default raised 180→1825d (5 years) per
 * พ.ร.บ.บัญชี ม.7 legal compliance. Retention is now resolved in this order:
 *   1. SystemConfig key `audit_log_retention_days` (OWNER-editable via UI)
 *   2. env var `AUDIT_LOG_RETENTION_DAYS` (ops escape hatch, no restart needed
 *      to override DB temporarily)
 *   3. DEFAULT_RETENTION_DAYS (1825)
 *
 * Schedule: Sunday 03:00 Asia/Bangkok. Lines up after the audit-chain-verify
 * cron at 03:45 on other days, avoiding lock contention.
 */
@Injectable()
export class AuditRetentionCron {
  private readonly logger = new Logger(AuditRetentionCron.name);
  /** D1.4.3.1 — 1825d = 5 years per พ.ร.บ.บัญชี ม.7 (was 180d pre-A1). */
  static readonly DEFAULT_RETENTION_DAYS = 1825;

  constructor(private readonly prisma: PrismaService) {}

  private async getRetentionDays(): Promise<number> {
    // Precedence 1: SystemConfig key `audit_log_retention_days` (OWNER-editable
    // via existing PATCH /settings flow, no restart). Read via PrismaService
    // directly rather than SettingsService to avoid an AuditModule ↔
    // SettingsModule circular dependency (SettingsService consumes AuditService
    // for change tracking; AuditModule providers cannot transitively re-import
    // SettingsModule).
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: 'audit_log_retention_days', deletedAt: null },
        select: { value: true },
      });
      if (row?.value) {
        const n = Number.parseInt(row.value, 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {
      // DB error during config read shouldn't break the cron — fall through
      // to env var / default.
    }
    // Precedence 2: env var (ops escape hatch)
    const raw = process.env.AUDIT_LOG_RETENTION_DAYS;
    if (raw) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    // Precedence 3: compliance default
    return AuditRetentionCron.DEFAULT_RETENTION_DAYS;
  }

  @Cron('0 3 * * 0', { timeZone: 'Asia/Bangkok' })
  async archiveOldEntries(): Promise<{ archived: number; retentionDays: number }> {
    const retentionDays = await this.getRetentionDays();
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
