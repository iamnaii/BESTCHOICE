import { Module } from '@nestjs/common';
import { ShopShippingController } from './shop-shipping.controller';
import { ShopShippingService } from './shop-shipping.service';

@Module({
  controllers: [ShopShippingController],
  providers: [ShopShippingService],
  exports: [ShopShippingService],
})
export class ShopShippingModule {}
