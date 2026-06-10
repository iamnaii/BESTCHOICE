import { Module } from '@nestjs/common';
import { JournalModule } from '../journal/journal.module';
import { DataAuditController } from './data-audit.controller';
import { DataAuditService } from './data-audit.service';
import { DataAuditChecksService } from './services/data-audit-checks.service';
import { ContractTraceService } from './services/contract-trace.service';
import { AuditFindingsService } from './services/audit-findings.service';
import { AuditBackfillService } from './services/audit-backfill.service';

@Module({
  imports: [JournalModule],
  controllers: [DataAuditController],
  providers: [
    DataAuditService,
    DataAuditChecksService,
    ContractTraceService,
    AuditFindingsService,
    AuditBackfillService,
  ],
  exports: [DataAuditService],
})
export class DataAuditModule {}
