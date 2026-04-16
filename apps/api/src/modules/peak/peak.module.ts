import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PeakController } from './peak.controller';
import { PeakService } from './peak.service';

@Module({
  imports: [PrismaModule, JournalModule, IntegrationsModule],
  controllers: [PeakController],
  providers: [PeakService],
  exports: [PeakService],
})
export class PeakModule {}
