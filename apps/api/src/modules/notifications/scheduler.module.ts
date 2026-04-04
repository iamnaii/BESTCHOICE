import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { NotificationsModule } from './notifications.module';
import { OverdueModule } from '../overdue/overdue.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductsModule } from '../products/products.module';
import { ReportsModule } from '../reports/reports.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [NotificationsModule, OverdueModule, InventoryModule, ProductsModule, ReportsModule, LineOaModule, DashboardModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
