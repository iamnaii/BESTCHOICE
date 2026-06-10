import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardOverviewService } from './services/dashboard-overview.service';
import { DashboardCollectionsService } from './services/dashboard-collections.service';
import { DashboardOpsService } from './services/dashboard-ops.service';

@Module({
  controllers: [DashboardController],
  providers: [
    DashboardService,
    DashboardOverviewService,
    DashboardCollectionsService,
    DashboardOpsService,
  ],
  exports: [DashboardService],
})
export class DashboardModule {}
