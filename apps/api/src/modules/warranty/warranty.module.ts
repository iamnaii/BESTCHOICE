import { Module, forwardRef } from '@nestjs/common';
import { WarrantyService } from './warranty.service';
import { WarrantyCron } from './warranty.cron';
import { WarrantyLineNotifierService } from './warranty-line-notifier.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  // forwardRef: WarrantyModule is imported by ContractsModule, and NotificationsModule
  // itself imports LineOaModule which forwardRef-imports ContractsModule back — this new
  // edge (Contracts -> Warranty -> Notifications -> LineOa -> Contracts) joins that
  // pre-existing cycle. Mirrors how NotificationsModule wraps its own LineOaModule import.
  // IntegrationsModule has no imports of its own (not actually part of any cycle) — wrapped
  // for consistency/future-proofing at zero cost (forwardRef is a no-op when there's no cycle).
  imports: [forwardRef(() => NotificationsModule), forwardRef(() => IntegrationsModule)],
  providers: [WarrantyService, WarrantyCron, WarrantyLineNotifierService],
  exports: [WarrantyService],
})
export class WarrantyModule {}
