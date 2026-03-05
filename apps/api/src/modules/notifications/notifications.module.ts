import { Module, forwardRef } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { SchedulerService } from './scheduler.service';
import { OverdueModule } from '../overdue/overdue.module';
import { ReorderPointsModule } from '../reorder-points/reorder-points.module';

@Module({
  imports: [OverdueModule, forwardRef(() => ReorderPointsModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService, SchedulerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
