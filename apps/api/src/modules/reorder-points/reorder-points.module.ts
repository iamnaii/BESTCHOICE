import { Module, forwardRef } from '@nestjs/common';
import { ReorderPointsController } from './reorder-points.controller';
import { ReorderPointsService } from './reorder-points.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [forwardRef(() => NotificationsModule)],
  controllers: [ReorderPointsController],
  providers: [ReorderPointsService],
  exports: [ReorderPointsService],
})
export class ReorderPointsModule {}
