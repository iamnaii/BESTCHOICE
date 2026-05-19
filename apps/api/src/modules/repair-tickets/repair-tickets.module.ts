import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ExpenseDocumentsModule } from '../expense-documents/expense-documents.module';
import { OtherIncomeModule } from '../other-income/other-income.module';
import { SettingsModule } from '../settings/settings.module';

// PrismaService is provided globally via @Global() PrismaModule — no import needed.

@Module({
  imports: [AuditModule, ExpenseDocumentsModule, OtherIncomeModule, SettingsModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class RepairTicketsModule {}
