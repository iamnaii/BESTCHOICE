import { Module } from '@nestjs/common';
import { FinanceCompanyContactsController } from './finance-company-contacts.controller';
import { FinanceCompanyContactsService } from './finance-company-contacts.service';

@Module({
  controllers: [FinanceCompanyContactsController],
  providers: [FinanceCompanyContactsService],
  exports: [FinanceCompanyContactsService],
})
export class FinanceCompanyContactsModule {}
