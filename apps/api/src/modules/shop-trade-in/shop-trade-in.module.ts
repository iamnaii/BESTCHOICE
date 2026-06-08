import { Module } from '@nestjs/common';
import { ShopTradeInController } from './shop-trade-in.controller';
import { ShopTradeInService } from './shop-trade-in.service';
import { TradeInIntakeModule } from './trade-in-intake.module';

// ShopBotDefenseModule is @Global — guard is available without importing.

@Module({
  imports: [TradeInIntakeModule],
  controllers: [ShopTradeInController],
  providers: [ShopTradeInService],
  exports: [ShopTradeInService],
})
export class ShopTradeInModule {}
