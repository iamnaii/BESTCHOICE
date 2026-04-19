import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { ReceivableReconService } from './receivable-recon.service';

/**
 * Daily 02:00 Asia/Bangkok — after close-of-business, before dashboards
 * materialize. Two responsibilities:
 *   1) Snapshot per-branch receivable vs payment outstanding (cron job)
 *   2) Purge rows older than the retention window
 */
@Injectable()
export class ReceivableReconCron {
  private readonly logger = new Logger(ReceivableReconCron.name);

  constructor(private readonly service: ReceivableReconService) {}

  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async dailyRecon(): Promise<void> {
    try {
      const result = await this.service.reconcileBranches();
      this.logger.log(
        `Receivable recon: ${result.rows} branch row(s), ${result.breached.length} breach(es)`,
      );
    } catch (err) {
      this.logger.error(`Receivable recon failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'receivable-recon' },
      });
    }

    try {
      const purge = await this.service.purgeOldLogs();
      if (purge.deleted > 0) {
        this.logger.log(`Purged ${purge.deleted} old receivable recon row(s)`);
      }
    } catch (err) {
      this.logger.error(`Receivable recon purge failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'receivable-recon-purge' },
      });
    }
  }
}
