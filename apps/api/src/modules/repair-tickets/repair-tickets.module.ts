import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ExpenseDocumentsModule } from '../expense-documents/expense-documents.module';
import { OtherIncomeModule } from '../other-income/other-income.module';
import { SettingsModule } from '../settings/settings.module';
import { RepairTicketsService } from './repair-tickets.service';
import { RepairTicketDocNumberService } from './services/doc-number.service';

// PrismaService is provided globally via @Global() PrismaModule — no import needed.

@Module({
  imports: [AuditModule, ExpenseDocumentsModule, OtherIncomeModule, SettingsModule],
  controllers: [],
  providers: [RepairTicketsService, RepairTicketDocNumberService],
  exports: [RepairTicketsService],
})
export class RepairTicketsModule {}
