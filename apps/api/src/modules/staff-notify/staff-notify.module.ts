import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StaffLineConfigService } from './staff-line-config.service';
import { StaffNotifyRulesService } from './staff-notify-rules.service';
import { StaffNotifyService } from './staff-notify.service';
import { StaffLineLinkService } from './staff-line-link.service';
import { SaleCompletedNotifier } from './sale-completed-notifier.service';
import { StaffLineWebhookController } from './staff-line-webhook.controller';
import { StaffNotifyController } from './staff-notify.controller';
import { AuditModule } from '../audit/audit.module';
import { LineStaffWebhookGuard } from '../chatbot-finance/guards/line-staff-webhook.guard';

/**
 * ก้อน 7 (A16) — แจ้งพนักงานทาง LINE · @Global เพื่อให้จุดเกิดเหตุทุกโมดูล inject `StaffNotifyService` แบบ @Optional() ได้โดยไม่ต้อง import
 */
@Global()
@Module({
  imports: [NotificationsModule, LineOaModule, IntegrationsModule, AuditModule],
  controllers: [StaffLineWebhookController, StaffNotifyController],
  providers: [StaffLineConfigService, StaffNotifyRulesService, StaffNotifyService, StaffLineLinkService, LineStaffWebhookGuard, SaleCompletedNotifier],
  exports: [StaffNotifyService, StaffLineConfigService, StaffNotifyRulesService, StaffLineLinkService, SaleCompletedNotifier],
})
export class StaffNotifyModule {}
