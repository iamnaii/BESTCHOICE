import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';
import { ShopFinanceSettlementService } from './shop-finance-settlement.service';
import { ShopFinanceSettlementController } from './shop-finance-settlement.controller';

@Module({
  imports: [PrismaModule, JournalModule], // JournalModule exports ShopFinanceReceiptTemplate
  controllers: [ShopFinanceSettlementController],
  providers: [ShopFinanceSettlementService],
})
export class ShopFinanceSettlementModule {}
