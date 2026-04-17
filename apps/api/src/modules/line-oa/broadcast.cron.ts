import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { BroadcastService } from './broadcast.service';

@Injectable()
export class BroadcastCron {
  private readonly logger = new Logger(BroadcastCron.name);

  constructor(private broadcastService: BroadcastService) {}

  @Cron('* * * * *', { timeZone: 'Asia/Bangkok' })
  async sendScheduledBroadcasts(): Promise<void> {
    try {
      const result = await this.broadcastService.sendScheduledMessages();
      if (result.sent > 0 || result.failed > 0) {
        this.logger.log(`Broadcast cron: sent ${result.sent}, failed ${result.failed}`);
      }
    } catch (error) {
      this.logger.error('Broadcast cron failed', error);
      Sentry.captureException(error, { tags: { kind: 'cron-job', cron: 'broadcast' } });
    }
  }
}
