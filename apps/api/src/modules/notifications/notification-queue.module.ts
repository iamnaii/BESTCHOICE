import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { NotificationQueueService } from './notification-queue.service';
import { NotificationWorker } from './notification.worker';

export const NOTIFICATION_QUEUE = 'notifications';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('REDIS_HOST');
        if (!host) {
          // No Redis — BullMQ will fail silently, fallback to direct send
          return { connection: { host: 'localhost', port: 6379, maxRetriesPerRequest: 0 } };
        }
        return {
          connection: {
            host,
            port: config.get<number>('REDIS_PORT', 6379),
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
  ],
  providers: [NotificationQueueService, NotificationWorker],
  exports: [NotificationQueueService],
})
export class NotificationQueueModule {}
