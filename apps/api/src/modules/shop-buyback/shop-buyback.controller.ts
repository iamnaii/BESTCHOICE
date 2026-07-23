import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ShopBuybackService } from './shop-buyback.service';
import { BuybackQuoteDto, SubmitBuybackDto } from './dto/quote.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

/**
 * Buyback instant-quote (yellobe-style) — public storefront, iPhone-only.
 * ⚠️ route order สำคัญ: static GET ทุกตัวต้องมาก่อน @Get(':id')
 */
@Controller('shop/buyback')
@UseGuards(ShopBotDefenseGuard)
export class ShopBuybackController {
  constructor(private service: ShopBuybackService) {}

  @Get('catalog')
  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  getCatalog() {
    return this.service.getCatalog();
  }

  @Get('questions')
  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  getQuestions() {
    return this.service.getQuestions();
  }

  @Post('quote')
  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  quote(@Body() dto: BuybackQuoteDto) {
    return this.service.quoteForAnswers(dto.model, dto.storage, dto.answers);
  }

  @Post('submit')
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  submit(@Body() dto: SubmitBuybackDto, @Req() req: Request & { user?: { sub?: string } }) {
    return this.service.submit(dto, req.user?.sub);
  }

  // ⚠️ ต้องอยู่ท้ายสุดเสมอ — ไม่งั้นกลืน catalog/questions
  @Get(':id')
  getStatus(@Param('id') id: string) {
    return this.service.getStatus(id);
  }
}
