import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { MdmAutoService } from './mdm-auto.service';

@Injectable()
export class MdmAutoCron {
  private readonly logger = new Logger(MdmAutoCron.name);

  constructor(private mdmAuto: MdmAutoService) {}

  @Cron('30 1 * * *', { timeZone: 'Asia/Bangkok' })
  async autoLockOverdue(): Promise<void> {
    this.logger.log('Starting MDM auto-lock scan');
    try {
      const result = await this.mdmAuto.autoLockOverdueContracts();
      this.logger.log(
        `MDM auto-lock: ${result.locked} locked, ${result.skipped} skipped, ${result.failed} failed`,
      );
    } catch (error) {
      this.logger.error('MDM auto-lock cron failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'mdm-auto-lock' },
      });
    }
  }
}
