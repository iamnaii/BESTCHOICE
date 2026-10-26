import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StaffLineConfigService } from './staff-line-config.service';
import { StaffNotifyRulesService } from './staff-notify-rules.service';
import { StaffNotifyService } from './staff-notify.service';
import { StaffLineLinkService } from './staff-line-link.service';
import { StaffLineWebhookController } from './staff-line-webhook.controller';
import { AuditModule } from '../audit/audit.module';
import { LineStaffWebhookGuard } from '../chatbot-finance/guards/line-staff-webhook.guard';

/**
 * ก้อน 7 (A16) — แจ้งพนักงานทาง LINE · @Global เพื่อให้จุดเกิดเหตุทุกโมดูล inject `StaffNotifyService` แบบ @Optional() ได้โดยไม่ต้อง import
 */
@Global()
@Module({
  imports: [NotificationsModule, LineOaModule, IntegrationsModule, AuditModule],
  controllers: [StaffLineWebhookController],
  providers: [StaffLineConfigService, StaffNotifyRulesService, StaffNotifyService, StaffLineLinkService, LineStaffWebhookGuard],
  exports: [StaffNotifyService, StaffLineConfigService, StaffNotifyRulesService, StaffLineLinkService],
})
export class StaffNotifyModule {}
