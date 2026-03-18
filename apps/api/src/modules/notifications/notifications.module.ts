import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { SmsWebhookController } from './sms-webhook.controller';
import { NotificationsService } from './notifications.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController, SmsWebhookController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
