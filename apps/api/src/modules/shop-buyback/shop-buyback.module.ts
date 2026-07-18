import { Module } from '@nestjs/common';
import { ShopBuybackController } from './shop-buyback.controller';
import { ShopBuybackService } from './shop-buyback.service';
import { BuybackPricingService } from './buyback-pricing.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';

// ShopBotDefenseModule is @Global — guard is available without importing.
// TradeInIntakeModule ถูกลบแล้ว (spec /sell 2026-07-18)

@Module({
  imports: [PrismaModule, LineOaModule],
  controllers: [ShopBuybackController],
  providers: [ShopBuybackService, BuybackPricingService],
  exports: [ShopBuybackService, BuybackPricingService],
})
export class ShopBuybackModule {}
