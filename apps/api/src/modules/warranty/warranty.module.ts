import { Module } from '@nestjs/common';
import { WarrantyService } from './warranty.service';
import { WarrantyCron } from './warranty.cron';
import { WarrantyLineNotifierService } from './warranty-line-notifier.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [NotificationsModule, IntegrationsModule],
  providers: [WarrantyService, WarrantyCron, WarrantyLineNotifierService],
  exports: [WarrantyService],
})
export class WarrantyModule {}
