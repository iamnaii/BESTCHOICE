import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingClosingController } from './closing.controller';
import { AccountingService } from './accounting.service';
import { PeakExportService } from './peak-export.service';
import { ReceivablesReportService } from './receivables-report.service';
import { TransactionalReportService } from './transactional-report.service';
import { GeneralLedgerReportService } from './general-ledger-report.service';
import { BadDebtService } from './bad-debt.service';
import { BadDebtProvisionCron } from './bad-debt-provision.cron';
import { MonthlyCloseService } from './monthly-close.service';
import { AccountingClosingService } from './closing.service';
import { ConsolidatedService } from './consolidated.service';
import { ConsolidatedController } from './consolidated.controller';
import { IntercompanyReportService } from './intercompany-report.service';
import { JournalModule } from '../journal/journal.module';
import { TaxModule } from '../tax/tax.module';
import { PeakModule } from '../peak/peak.module';
import { ConsecutiveMissedModule } from '../overdue/consecutive-missed.module';
import { ReceiptsModule } from '../receipts/receipts.module';

// No forwardRef needed: PaymentsModule already imports both ReceiptsModule
// and AccountingModule side-by-side with no cycle (payments.module.ts), and
// ReceiptsModule's own chain (PrismaModule, LineOaModule, JournalModule)
// never imports AccountingModule (verified 2026-07-24, Phase 3 Task 3).
@Module({
  imports: [JournalModule, TaxModule, PeakModule, ConsecutiveMissedModule, ReceiptsModule],
  controllers: [AccountingController, AccountingClosingController, ConsolidatedController],
  providers: [
    AccountingService,
    PeakExportService,
    ReceivablesReportService,
    TransactionalReportService,
    GeneralLedgerReportService,
    BadDebtService,
    BadDebtProvisionCron,
    MonthlyCloseService,
    AccountingClosingService,
    ConsolidatedService,
    IntercompanyReportService,
  ],
  exports: [
    AccountingService,
    BadDebtService,
    MonthlyCloseService,
    AccountingClosingService,
    ConsolidatedService,
    IntercompanyReportService,
  ],
})
export class AccountingModule {}
