import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PeakController } from './peak.controller';
import { PeakService } from './peak.service';
import { PeakSyncCron } from './peak-sync.cron';

@Module({
  imports: [PrismaModule, JournalModule, IntegrationsModule],
  controllers: [PeakController],
  providers: [PeakService, PeakSyncCron],
  exports: [PeakService],
})
export class PeakModule {}
