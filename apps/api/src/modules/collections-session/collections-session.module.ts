import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { CollectionsSessionController } from './collections-session.controller';
import { CollectionsSessionService } from './collections-session.service';
import { AutoAssignService } from './auto-assign.service';
import { PoolService } from './pool.service';
import { CollectionsSessionCron } from './collections-session.cron';
import { CollectionsSummaryService } from './collections-summary.service';
import { TeamDashboardService } from './team-dashboard.service';

@Module({
  imports: [PrismaModule, SettingsModule, LineOaModule],
  controllers: [CollectionsSessionController],
  providers: [
    CollectionsSessionService,
    AutoAssignService,
    PoolService,
    CollectionsSessionCron,
    CollectionsSummaryService,
    TeamDashboardService,
  ],
  exports: [CollectionsSessionService, AutoAssignService],
})
export class CollectionsSessionModule {}
