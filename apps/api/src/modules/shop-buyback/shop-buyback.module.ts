import { Module } from '@nestjs/common';
import { ShopBuybackController } from './shop-buyback.controller';
import { ShopBuybackService } from './shop-buyback.service';
import { BuybackPricingService } from './buyback-pricing.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';

// ShopBotDefenseModule is @Global — guard is available without importing.
// จงใจไม่ import TradeInIntakeModule แล้ว (fork ตาม spec §7.5)

@Module({
  imports: [PrismaModule, LineOaModule],
  controllers: [ShopBuybackController],
  providers: [ShopBuybackService, BuybackPricingService],
  exports: [ShopBuybackService, BuybackPricingService],
})
export class ShopBuybackModule {}
