import { Module } from '@nestjs/common';
import { FinanceReceivableContactLogsController } from './finance-receivable-contact-logs.controller';
import { FinanceReceivableContactLogsService } from './finance-receivable-contact-logs.service';
import { BrokenPromiseFinanceCron } from './crons/broken-promise-finance.cron';

@Module({
  controllers: [FinanceReceivableContactLogsController],
  providers: [FinanceReceivableContactLogsService, BrokenPromiseFinanceCron],
  exports: [FinanceReceivableContactLogsService],
})
export class FinanceReceivableContactLogsModule {}
