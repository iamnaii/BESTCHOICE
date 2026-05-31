import { Module } from '@nestjs/common';
import { FinanceReceivableContactLogsController } from './finance-receivable-contact-logs.controller';
import { FinanceReceivableContactLogsService } from './finance-receivable-contact-logs.service';

@Module({
  controllers: [FinanceReceivableContactLogsController],
  providers: [FinanceReceivableContactLogsService],
  exports: [FinanceReceivableContactLogsService],
})
export class FinanceReceivableContactLogsModule {}
