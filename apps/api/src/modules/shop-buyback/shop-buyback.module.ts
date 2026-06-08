import { Module } from '@nestjs/common';
import { ShopBuybackController } from './shop-buyback.controller';
import { ShopBuybackService } from './shop-buyback.service';
import { TradeInIntakeModule } from '../shop-trade-in/trade-in-intake.module';

// ShopBotDefenseModule is @Global — guard is available without importing.

@Module({
  imports: [TradeInIntakeModule],
  controllers: [ShopBuybackController],
  providers: [ShopBuybackService],
  exports: [ShopBuybackService],
})
export class ShopBuybackModule {}
