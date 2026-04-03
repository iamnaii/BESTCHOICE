import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { SmsWebhookController } from './sms-webhook.controller';
import { NotificationsService } from './notifications.service';
import { EventsGateway } from './events.gateway';
import { PrismaModule } from '../../prisma/prisma.module';

// WebSocket gateway requires ENABLE_WEBSOCKET=true (disabled by default in Cloud Run)
const enableWebSocket = process.env.ENABLE_WEBSOCKET === 'true';

@Module({
  imports: [
    PrismaModule,
    ...(enableWebSocket ? [JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    })] : []),
  ],
  controllers: [NotificationsController, SmsWebhookController],
  providers: [NotificationsService, ...(enableWebSocket ? [EventsGateway] : [])],
  exports: [NotificationsService, ...(enableWebSocket ? [EventsGateway] : [])],
})
export class NotificationsModule {}
