import { Module } from '@nestjs/common';
import { TradeInIntakeService } from './trade-in-intake.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';

/**
 * Shared device-intake service used by both ShopBuybackModule and
 * ShopTradeInModule (Wave-4 fold of shop-buyback ≈ shop-trade-in).
 */
@Module({
  imports: [PrismaModule, LineOaModule],
  providers: [TradeInIntakeService],
  exports: [TradeInIntakeService],
})
export class TradeInIntakeModule {}
