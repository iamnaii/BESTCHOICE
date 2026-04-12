import { Module } from '@nestjs/common';
import { JournalModule } from '../journal/journal.module';
import { DataAuditController } from './data-audit.controller';
import { DataAuditService } from './data-audit.service';

@Module({
  imports: [JournalModule],
  controllers: [DataAuditController],
  providers: [DataAuditService],
  exports: [DataAuditService],
})
export class DataAuditModule {}
