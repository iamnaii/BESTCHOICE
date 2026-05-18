import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingClosingController } from './closing.controller';
import { AccountingService } from './accounting.service';
import { BadDebtService } from './bad-debt.service';
import { BadDebtProvisionCron } from './bad-debt-provision.cron';
import { BankReconciliationService } from './bank-reconciliation.service';
import { MonthlyCloseService } from './monthly-close.service';
import { AccountingClosingService } from './closing.service';
import { ConsolidatedService } from './consolidated.service';
import { ConsolidatedController } from './consolidated.controller';
import { JournalModule } from '../journal/journal.module';
import { TaxModule } from '../tax/tax.module';
import { PeakModule } from '../peak/peak.module';

@Module({
  imports: [JournalModule, TaxModule, PeakModule],
  controllers: [AccountingController, AccountingClosingController, ConsolidatedController],
  providers: [
    AccountingService,
    BadDebtService,
    BadDebtProvisionCron,
    BankReconciliationService,
    MonthlyCloseService,
    AccountingClosingService,
    ConsolidatedService,
  ],
  exports: [
    AccountingService,
    BadDebtService,
    BankReconciliationService,
    MonthlyCloseService,
    AccountingClosingService,
    ConsolidatedService,
  ],
})
export class AccountingModule {}
