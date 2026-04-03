import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NOTIFICATION_QUEUE } from './notification-queue.module';

export interface NotificationJobData {
  type: 'LINE' | 'SMS' | 'EMAIL';
  recipientId?: string;     // customer or user ID
  recipientPhone?: string;  // for SMS
  recipientEmail?: string;  // for email
  recipientLineId?: string; // for LINE
  templateKey: string;      // notification template name
  variables: Record<string, string>;  // template variables
  contractId?: string;
  priority?: 'high' | 'normal' | 'low';
}

/**
 * Queue-based notification dispatch.
 * Uses BullMQ + Redis for persistent, retry-able notification delivery.
 * Falls back to direct dispatch if Redis is unavailable.
 */
@Injectable()
export class NotificationQueueService {
  private readonly logger = new Logger(NotificationQueueService.name);
  private isQueueAvailable = true;

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private queue: Queue,
  ) {
    // Check if queue is connected
    this.queue.client.then(() => {
      this.isQueueAvailable = true;
      this.logger.log('Notification queue connected to Redis');
    }).catch(() => {
      this.isQueueAvailable = false;
      this.logger.warn('Notification queue: Redis unavailable, falling back to direct dispatch');
    });
  }

  /** Enqueue a notification for async delivery */
  async enqueue(data: NotificationJobData): Promise<string | null> {
    if (!this.isQueueAvailable) return null;

    try {
      const priority = data.priority === 'high' ? 1 : data.priority === 'low' ? 3 : 2;
      const job = await this.queue.add(data.type, data, {
        priority,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }, // 5s, 25s, 125s
        removeOnComplete: { age: 86400 },  // keep completed jobs for 1 day
        removeOnFail: { age: 604800 },     // keep failed jobs for 7 days
      });
      return job.id ?? null;
    } catch (err) {
      this.logger.warn('Failed to enqueue notification, will send directly', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /** Enqueue payment reminder (high priority) */
  async enqueuePaymentReminder(contractId: string, customerPhone: string, variables: Record<string, string>) {
    return this.enqueue({
      type: 'SMS',
      recipientPhone: customerPhone,
      templateKey: 'payment_reminder',
      variables,
      contractId,
      priority: 'high',
    });
  }

  /** Enqueue overdue notice */
  async enqueueOverdueNotice(contractId: string, recipientLineId: string, variables: Record<string, string>) {
    return this.enqueue({
      type: 'LINE',
      recipientLineId,
      templateKey: 'overdue_notice',
      variables,
      contractId,
      priority: 'high',
    });
  }

  /** Get queue health stats */
  async getQueueStats() {
    if (!this.isQueueAvailable) return { available: false };
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
      ]);
      return { available: true, waiting, active, completed, failed, delayed };
    } catch {
      return { available: false };
    }
  }
}
