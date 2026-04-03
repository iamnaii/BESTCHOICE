import { Module, DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { NotificationQueueService } from './notification-queue.service';
import { NotificationWorker } from './notification.worker';

export const NOTIFICATION_QUEUE = 'notifications';

/**
 * BullMQ notification queue module.
 * Only registers BullMQ if REDIS_HOST is configured.
 * Without Redis, NotificationQueueService stubs all methods (no-op).
 */
@Module({})
export class NotificationQueueModule {
  static register(): DynamicModule {
    const redisHost = process.env.REDIS_HOST;

    if (!redisHost) {
      // No Redis — provide stub service that does nothing
      return {
        module: NotificationQueueModule,
        providers: [
          {
            provide: NotificationQueueService,
            useValue: {
              enqueue: async () => null,
              enqueuePaymentReminder: async () => null,
              enqueueOverdueNotice: async () => null,
              getQueueStats: async () => ({ available: false }),
            },
          },
        ],
        exports: [NotificationQueueService],
      };
    }

    return {
      module: NotificationQueueModule,
      imports: [
        BullModule.forRootAsync({
          useFactory: (config: ConfigService) => ({
            connection: {
              host: config.get<string>('REDIS_HOST'),
              port: config.get<number>('REDIS_PORT', 6379),
            },
          }),
          inject: [ConfigService],
        }),
        BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
      ],
      providers: [NotificationQueueService, NotificationWorker],
      exports: [NotificationQueueService],
    };
  }
}
