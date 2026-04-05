import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { BadDebtService } from './bad-debt.service';

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, BadDebtService],
  exports: [AccountingService, BadDebtService],
})
export class AccountingModule {}
