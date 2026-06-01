import { Module } from '@nestjs/common';
import { ExternalFinanceController } from './external-finance.controller';
import { ExternalFinanceService } from './external-finance.service';
import { ExternalFinanceCommissionService } from './external-finance-commission.service';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [ContactsModule],
  controllers: [ExternalFinanceController],
  providers: [ExternalFinanceService, ExternalFinanceCommissionService],
  exports: [ExternalFinanceCommissionService],
})
export class ExternalFinanceModule {}
