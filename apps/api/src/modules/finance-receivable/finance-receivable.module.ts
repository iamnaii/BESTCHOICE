import { Module } from '@nestjs/common';
import { FinanceReceivableController } from './finance-receivable.controller';
import { FinanceReceivableService } from './finance-receivable.service';

@Module({
  controllers: [FinanceReceivableController],
  providers: [FinanceReceivableService],
  exports: [FinanceReceivableService],
})
export class FinanceReceivableModule {}
