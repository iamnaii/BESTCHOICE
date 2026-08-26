import { Module } from '@nestjs/common';
import { FinanceReceivableController } from './finance-receivable.controller';
import { FinanceReceivableService } from './finance-receivable.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [FinanceReceivableController],
  providers: [FinanceReceivableService],
  exports: [FinanceReceivableService],
})
export class FinanceReceivableModule {}
