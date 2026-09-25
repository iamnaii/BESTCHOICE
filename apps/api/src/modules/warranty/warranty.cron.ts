import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { WarrantyService } from './warranty.service';
import {
  WarrantyLineNotifierService,
  WarrantyNotifyResult,
} from './warranty-line-notifier.service';

@Injectable()
export class WarrantyCron {
  private readonly logger = new Logger(WarrantyCron.name);

  constructor(
    private warrantyService: WarrantyService,
    private notifier: WarrantyLineNotifierService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })
  async checkExpiringWarranties(): Promise<void> {
    try {
      const expiring = await this.warrantyService.getExpiringWarranties(7);
      const tally: Record<WarrantyNotifyResult, number> = {
        SENT: 0,
        NO_LINK: 0,
        DUP: 0,
        BLOCKED: 0,
        FAILED: 0,
      };
      for (const item of expiring) {
        try {
          tally[await this.notifier.notifyExpiring(item)]++;
        } catch (e) {
          tally.FAILED++;
          Sentry.captureException(e, {
            tags: { kind: 'cron-job', cron: 'warranty-check', step: 'notify' },
          });
        }
      }
      this.logger.log(`Expiring warranties ${expiring.length}: ${JSON.stringify(tally)}`);
    } catch (error) {
      this.logger.error('Warranty check failed', error);
      Sentry.captureException(error, { tags: { kind: 'cron-job', cron: 'warranty-check' } });
    }
  }
}
