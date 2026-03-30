import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { NotificationsModule } from './notifications.module';
import { ReorderPointsModule } from '../reorder-points/reorder-points.module';
import { LineOaModule } from '../line-oa/line-oa.module';

@Module({
  imports: [NotificationsModule, ReorderPointsModule, LineOaModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
