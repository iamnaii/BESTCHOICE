import { Module } from '@nestjs/common';
import { YeastarTokenService } from './yeastar-token.service';
import { YeastarService } from './yeastar.service';
import { YeastarController } from './yeastar.controller';
import { YeastarWebhookController } from './yeastar-webhook.controller';
import { YeastarCdrCron } from './yeastar-cdr.cron';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [IntegrationsModule, NotificationsModule],
  controllers: [YeastarController, YeastarWebhookController],
  providers: [YeastarTokenService, YeastarService, YeastarCdrCron],
  exports: [YeastarService],
})
export class YeastarModule {}
