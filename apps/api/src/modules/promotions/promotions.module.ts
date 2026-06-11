import { Module } from '@nestjs/common';
import { PromotionsController } from './promotions.controller';
import { ShopPromotionsController } from './shop-promotions.controller';
import { PromotionsService } from './promotions.service';
import { ShopBotDefenseModule } from '../shop-bot-defense/shop-bot-defense.module';

@Module({
  imports: [ShopBotDefenseModule],
  controllers: [PromotionsController, ShopPromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
