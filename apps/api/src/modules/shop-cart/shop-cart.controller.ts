import { BadRequestException, Controller, Get, Headers, UseGuards } from '@nestjs/common';
import { ShopCartService } from './shop-cart.service';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

@Controller('shop/cart')
@UseGuards(ShopBotDefenseGuard)
export class ShopCartController {
  constructor(private service: ShopCartService) {}

  @Get()
  async get(@Headers('x-shop-session') sessionId: string) {
    if (!sessionId) throw new BadRequestException('missing session');
    const items = await this.service.listForSession(sessionId);
    const subtotal = items.reduce((a, i) => a + i.product.sellingPrice, 0);
    return { items, subtotal };
  }
}
