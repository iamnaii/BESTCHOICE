import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OutboxService } from '../outbox.service';

@Injectable()
export class ReconciliationCron {
  private readonly logger = new Logger(ReconciliationCron.name);

  constructor(private readonly outbox: OutboxService) {}

  // Daily 04:00 BKK (= 21:00 UTC previous day)
  @Cron('0 21 * * *', { name: 'outbox-reconciliation', timeZone: 'UTC' })
  async tick() {
    try {
      const failed = await this.outbox.findFailed();
      if (failed.length > 0) {
        this.logger.warn(
          `Reconciliation: ${failed.length} FAILED outbox events need manual attention`,
        );
        // Sentry already captured each individual failure;
        // this is a daily aggregate signal for the ops team.
      } else {
        this.logger.log('Reconciliation: 0 FAILED outbox events — all balances paired');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Reconciliation tick failed: ${msg}`);
    }
  }
}
