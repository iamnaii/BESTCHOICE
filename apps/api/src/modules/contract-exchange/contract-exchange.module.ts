import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { JournalModule } from '../journal/journal.module';
import { ContractExchangeController } from './contract-exchange.controller';
import { ContractExchangeService } from './contract-exchange.service';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeClearVendor21_1106Template } from '../journal/cpa-templates/exchange-clear-vendor-21-1106.template';

@Module({
  imports: [PrismaModule, AuditModule, JournalModule],
  controllers: [ContractExchangeController],
  providers: [
    ContractExchangeService,
    ExchangeNewContract1ATemplate,
    ExchangeCloseOld21_1106Template,
    ExchangeClearVendor21_1106Template,
  ],
  exports: [ContractExchangeService],
})
export class ContractExchangeModule {}
