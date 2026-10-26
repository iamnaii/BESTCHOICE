import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StaffLineConfigService } from './staff-line-config.service';
import { StaffNotifyRulesService } from './staff-notify-rules.service';
import { StaffNotifyService } from './staff-notify.service';

/**
 * ก้อน 7 (A16) — แจ้งพนักงานทาง LINE · @Global เพื่อให้จุดเกิดเหตุทุกโมดูล inject `StaffNotifyService` แบบ @Optional() ได้โดยไม่ต้อง import
 */
@Global()
@Module({
  imports: [NotificationsModule, LineOaModule, IntegrationsModule],
  providers: [StaffLineConfigService, StaffNotifyRulesService, StaffNotifyService],
  exports: [StaffNotifyService, StaffLineConfigService, StaffNotifyRulesService],
})
export class StaffNotifyModule {}
