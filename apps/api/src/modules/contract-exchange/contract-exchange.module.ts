import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { JournalModule } from '../journal/journal.module';
import { ContractExchangeController } from './contract-exchange.controller';
import { ContractExchangeService } from './contract-exchange.service';
import { ExchangeCancelService } from './contract-exchange-cancel.service';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeBuybackReceivable11_2107Template } from '../journal/cpa-templates/exchange-buyback-receivable-11-2107.template';
import { ShopExchangeReturnTemplate } from '../journal/cpa-templates/shop-exchange-return.template';
import { ExchangeEclReversalTemplate } from '../journal/cpa-templates/exchange-ecl-reversal.template';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';

@Module({
  // JournalModule already exports CompanyResolverService — no need to re-provide.
  imports: [PrismaModule, AuditModule, JournalModule],
  controllers: [ContractExchangeController],
  providers: [
    ContractExchangeService,
    ExchangeCancelService,
    ExchangeNewContract1ATemplate,
    ExchangeCloseOld21_1106Template,
    ExchangeBuybackReceivable11_2107Template,
    ShopExchangeReturnTemplate,
    ExchangeEclReversalTemplate,
    ExchangeCancelReversalTemplate,
  ],
  exports: [ContractExchangeService],
})
export class ContractExchangeModule {}
