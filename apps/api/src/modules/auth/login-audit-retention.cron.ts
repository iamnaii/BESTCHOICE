import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * LoginAuditLog retention: hard-delete rows older than 90 days.
 *
 * Why 90d: PDPA pressure (keep the minimum needed); 90 days captures most
 * incident-response windows (brute-force waves, credential-stuffing campaigns).
 * Runs daily at 03:30 Asia/Bangkok — after the 03:00 heavy cleanups but before
 * the 04:00 retention waves so we don't compete for locks.
 */
@Injectable()
export class LoginAuditRetentionCron {
  private readonly logger = new Logger(LoginAuditRetentionCron.name);
  static readonly RETENTION_DAYS = 90;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('30 3 * * *', { timeZone: 'Asia/Bangkok' })
  async purgeOldEntries(): Promise<{ deleted: number }> {
    try {
      const cutoff = new Date(
        Date.now() - LoginAuditRetentionCron.RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const result = await this.prisma.loginAuditLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (result.count > 0) {
        this.logger.log(`LoginAuditLog retention: deleted ${result.count} row(s) older than ${LoginAuditRetentionCron.RETENTION_DAYS}d`);
      }
      return { deleted: result.count };
    } catch (err) {
      this.logger.error(`Login audit retention failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'login-audit-retention' } });
      return { deleted: 0 };
    }
  }
}
