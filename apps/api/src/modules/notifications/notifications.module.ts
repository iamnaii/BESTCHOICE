import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { SmsWebhookController } from './sms-webhook.controller';
import { NotificationsService } from './notifications.service';
import { EventsGateway } from './events.gateway';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [NotificationsController, SmsWebhookController],
  providers: [NotificationsService, EventsGateway],
  exports: [NotificationsService, EventsGateway],
})
export class NotificationsModule {}
