import { Controller, Get, UseGuards } from '@nestjs/common';
import { ShopShippingService } from './shop-shipping.service';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

@Controller('shop/shipping')
@UseGuards(ShopBotDefenseGuard)
export class ShopShippingController {
  constructor(private service: ShopShippingService) {}

  @Get('methods')
  listMethods() {
    return this.service.listMethods();
  }
}
