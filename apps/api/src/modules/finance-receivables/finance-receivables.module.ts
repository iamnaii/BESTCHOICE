import { Module } from '@nestjs/common';
import { FinanceReceivablesController } from './finance-receivables.controller';
import { FinanceReceivablesService } from './finance-receivables.service';

@Module({
  controllers: [FinanceReceivablesController],
  providers: [FinanceReceivablesService],
  exports: [FinanceReceivablesService],
})
export class FinanceReceivablesModule {}
