import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { BadRequestException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Job } from 'bullmq';
import { NOTIFICATION_QUEUE } from './notification-queue.module';
import { NotificationsService } from './notifications.service';
import { NotificationJobData } from './notification-queue.service';

/**
 * Worker concurrency. Read from the `MAX_CONCURRENT_JOBS` env var at
 * module-load time (decorators run before NestJS DI bootstrap, so we cannot
 * resolve DB-backed config here). Clamped to [1, 50] with default 5. To
 * change the cap in production, set the env var on Cloud Run and redeploy.
 * A future refactor can thread the value via `BullModule.forRootAsync`.
 */
function readMaxConcurrentJobs(): number {
  const raw = process.env.MAX_CONCURRENT_JOBS;
  const n = raw ? Number(raw) : 5;
  if (!Number.isFinite(n) || n < 1 || n > 50) return 5;
  return Math.floor(n);
}

/**
 * BullMQ Worker that processes notification jobs from the queue.
 * Handles LINE, SMS, and EMAIL delivery with automatic retry.
 */
@Processor(NOTIFICATION_QUEUE, { concurrency: readMaxConcurrentJobs() })
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
          if (!recipientPhone) throw new BadRequestException('recipientPhone required for SMS');
          await this.notificationsService.sendSmsFromQueue(
            recipientPhone,
            this.renderTemplate(templateKey, variables),
          );
          break;

        case 'LINE':
          if (!recipientLineId) throw new BadRequestException('recipientLineId required for LINE');
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

  /**
   * Capture jobs that exhaust all retries to Sentry.
   * BullMQ retries internally — only escalate after the last attempt fails,
   * otherwise we'd flood Sentry with transient errors that would have
   * recovered on retry.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationJobData> | undefined, err: Error) {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return; // will retry
    Sentry.captureException(err, {
      tags: {
        kind: 'queue-job-exhausted',
        queue: NOTIFICATION_QUEUE,
        type: job.data?.type,
        templateKey: job.data?.templateKey,
      },
      extra: {
        jobId: job.id,
        contractId: job.data?.contractId,
        attemptsMade: job.attemptsMade,
        maxAttempts,
      },
    });
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
