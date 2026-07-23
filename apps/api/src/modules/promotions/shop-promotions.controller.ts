import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PromotionsService } from './promotions.service';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

/**
 * Public promotions feed for the customer-facing web-shop (www.bestchoicephone.com).
 *
 * Intentionally unauthenticated — anonymous shoppers browse promotions before
 * they have any account. Returns only display-safe fields (no usage counters);
 * guarded by ShopBotDefenseGuard like every other /shop/* endpoint.
 */
@Controller('shop/promotions')
@UseGuards(ShopBotDefenseGuard)
export class ShopPromotionsController {
  constructor(private promotionsService: PromotionsService) {}

  @Get()
  @Throttle({ short: { limit: 30, ttl: 60_000 } })
  findActive() {
    return this.promotionsService.findActivePublic();
  }
}
