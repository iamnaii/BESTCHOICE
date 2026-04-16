import { Module } from '@nestjs/common';
import { GlobalCreditCheckController, CreditCheckController, CustomerCreditCheckController } from './credit-check.controller';
import { CreditCheckService } from './credit-check.service';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [IntegrationsModule],
  controllers: [GlobalCreditCheckController, CreditCheckController, CustomerCreditCheckController],
  providers: [CreditCheckService],
  exports: [CreditCheckService],
})
export class CreditCheckModule {}
