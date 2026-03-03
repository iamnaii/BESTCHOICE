import { Module } from '@nestjs/common';
import { CreditCheckController, CustomerCreditCheckController } from './credit-check.controller';
import { CreditCheckService } from './credit-check.service';

@Module({
  controllers: [CreditCheckController, CustomerCreditCheckController],
  providers: [CreditCheckService],
  exports: [CreditCheckService],
})
export class CreditCheckModule {}
