import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { NotificationsModule } from './notifications.module';
import { OverdueModule } from '../overdue/overdue.module';
import { ReorderPointsModule } from '../reorder-points/reorder-points.module';
import { ProductsModule } from '../products/products.module';
import { LineOaModule } from '../line-oa/line-oa.module';

@Module({
  imports: [NotificationsModule, OverdueModule, ReorderPointsModule, ProductsModule, LineOaModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
