import { Module } from '@nestjs/common';
import { ShopCheckoutService } from './shop-checkout.service';
import { ShopCheckoutController } from './shop-checkout.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { ShopShippingModule } from '../shop-shipping/shop-shipping.module';
import { PaySolutionsModule } from '../paysolutions/paysolutions.module';
import { SalesModule } from '../sales/sales.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    PromotionsModule,
    LoyaltyModule,
    ShopShippingModule,
    PaySolutionsModule,
    SalesModule,
    AuthModule,
  ],
  controllers: [ShopCheckoutController],
  providers: [ShopCheckoutService],
  exports: [ShopCheckoutService],
})
export class ShopCheckoutModule {}
