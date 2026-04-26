import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CollectionsSessionController } from './collections-session.controller';
import { CollectionsSessionService } from './collections-session.service';
import { AutoAssignService } from './auto-assign.service';
import { PoolService } from './pool.service';
import { CollectionsSessionCron } from './collections-session.cron';

@Module({
  imports: [PrismaModule],
  controllers: [CollectionsSessionController],
  providers: [CollectionsSessionService, AutoAssignService, PoolService, CollectionsSessionCron],
  exports: [CollectionsSessionService, AutoAssignService],
})
export class CollectionsSessionModule {}
