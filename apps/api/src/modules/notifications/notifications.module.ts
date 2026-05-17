import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { SmsWebhookController } from './sms-webhook.controller';
import { NotificationsService } from './notifications.service';
import { EventsGateway } from './events.gateway';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { NotificationTemplateService } from './notification-template.service';
import {
  EmailProviderService,
  SmtpEmailProvider,
  SendgridEmailProvider,
} from './email-provider.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PDPAModule } from '../pdpa/pdpa.module';

// WebSocket gateway requires ENABLE_WEBSOCKET=true (disabled by default in Cloud Run)
const enableWebSocket = process.env.ENABLE_WEBSOCKET === 'true';

@Module({
  imports: [
    PrismaModule,
    IntegrationsModule,
    PDPAModule,
    forwardRef(() => LineOaModule),
    ...(enableWebSocket ? [JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    })] : []),
  ],
  controllers: [NotificationsController, SmsWebhookController],
  providers: [
    NotificationsService,
    ComplianceService,
    HolidayService,
    NotificationTemplateService,
    SmtpEmailProvider,
    SendgridEmailProvider,
    EmailProviderService,
    ...(enableWebSocket ? [EventsGateway] : []),
  ],
  exports: [
    NotificationsService,
    ComplianceService,
    HolidayService,
    NotificationTemplateService,
    EmailProviderService,
    ...(enableWebSocket ? [EventsGateway] : []),
  ],
})
export class NotificationsModule {}
