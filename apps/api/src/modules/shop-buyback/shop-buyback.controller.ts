import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ShopBuybackService } from './shop-buyback.service';
import { QuickQuoteDto } from './dto/quick-quote.dto';
import { SubmitBuybackDto } from './dto/submit.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

/**
 * Online buyback (pure cash-out) submission for the public shop.
 * flow=BUYBACK means no target product — customer just wants to sell their
 * old phone for cash. See ShopTradeInController for EXCHANGE flow.
 */
@Controller('shop/buyback')
@UseGuards(ShopBotDefenseGuard)
export class ShopBuybackController {
  constructor(private service: ShopBuybackService) {}

  @Post('quick-quote')
  quickQuote(@Body() dto: QuickQuoteDto) {
    return this.service.quickQuote(dto);
  }

  @Post('submit')
  submit(@Body() dto: SubmitBuybackDto, @Req() req: Request & { user?: { sub?: string } }) {
    return this.service.submit(dto, req.user?.sub);
  }

  @Get(':id')
  getStatus(@Param('id') id: string) {
    return this.service.getStatus(id);
  }
}
