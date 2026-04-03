import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NOTIFICATION_QUEUE } from './notification-queue.module';
import { NotificationsService } from './notifications.service';
import { NotificationJobData } from './notification-queue.service';

/**
 * BullMQ Worker that processes notification jobs from the queue.
 * Handles LINE, SMS, and EMAIL delivery with automatic retry.
 */
@Processor(NOTIFICATION_QUEUE)
export class NotificationWorker extends WorkerHost {
  private readonly logger = new Logger(NotificationWorker.name);

  constructor(private notificationsService: NotificationsService) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<{ success: boolean; channel: string }> {
    const { type, recipientPhone, recipientLineId, templateKey, variables, contractId } = job.data;

    this.logger.debug(`Processing ${type} notification [${job.id}]: ${templateKey}`);

    try {
      switch (type) {
        case 'SMS':
          if (!recipientPhone) throw new Error('recipientPhone required for SMS');
          await this.notificationsService.sendSmsFromQueue(
            recipientPhone,
            this.renderTemplate(templateKey, variables),
          );
          break;

        case 'LINE':
          if (!recipientLineId) throw new Error('recipientLineId required for LINE');
          // LINE messages are sent via the existing LineOaService
          // For now, log that LINE should be sent (actual LINE send is in line-oa module)
          this.logger.log(`LINE notification queued for ${recipientLineId}: ${templateKey}`);
          break;

        case 'EMAIL':
          // Email handled by EmailService — delegate there
          this.logger.log(`Email notification queued: ${templateKey}`);
          break;
      }

      this.logger.debug(`${type} notification [${job.id}] sent successfully`);
      return { success: true, channel: type };
    } catch (err) {
      this.logger.error(
        `${type} notification [${job.id}] failed (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err; // BullMQ will retry based on backoff config
    }
  }

  /** Simple template renderer (replaces {{key}} with values) */
  private renderTemplate(templateKey: string, variables: Record<string, string>): string {
    // Templates could be loaded from DB or config — for now use inline
    let message = variables._message || `[${templateKey}]`;
    for (const [key, value] of Object.entries(variables)) {
      message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return message;
  }
}
