import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingClosingController } from './closing.controller';
import { AccountingService } from './accounting.service';
import { PeakExportService } from './peak-export.service';
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

@Module({
  imports: [JournalModule, TaxModule, PeakModule],
  controllers: [AccountingController, AccountingClosingController, ConsolidatedController],
  providers: [
    AccountingService,
    PeakExportService,
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
