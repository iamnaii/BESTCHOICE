import { Module } from '@nestjs/common';
import { CreditCheckController } from './credit-check.controller';
import { CreditCheckService } from './credit-check.service';

@Module({
  controllers: [CreditCheckController],
  providers: [CreditCheckService],
  exports: [CreditCheckService],
})
export class CreditCheckModule {}
