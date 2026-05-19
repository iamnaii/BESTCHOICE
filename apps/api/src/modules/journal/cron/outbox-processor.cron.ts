import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxProcessorService } from '../outbox-processor.service';

@Injectable()
export class OutboxProcessorCron {
  private readonly logger = new Logger(OutboxProcessorCron.name);

  constructor(private readonly processor: OutboxProcessorService) {}

  // Every 30 seconds — matches saga retry rhythm
  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'outbox-processor' })
  async tick() {
    try {
      const result = await this.processor.processOutbox(50);
      if (result.processed + result.failed > 0) {
        this.logger.log(
          `Outbox cycle: ${result.processed} processed, ${result.failed} failed`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Outbox tick failed: ${msg}`);
    }
  }
}
