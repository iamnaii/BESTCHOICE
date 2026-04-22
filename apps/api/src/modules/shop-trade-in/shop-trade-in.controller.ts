import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ShopTradeInService } from './shop-trade-in.service';
import { EstimateDto } from './dto/estimate.dto';
import { SubmitTradeInDto } from './dto/submit.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

/**
 * Online trade-in submission for the public shop (bestchoicephone.app).
 * Protected by ShopBotDefenseGuard — rate-limit + user-agent classification.
 * Endpoints are intentionally public (no JwtAuthGuard) — a walk-in customer
 * may not yet be an authenticated shop user; staff link the submission to a
 * customer record during appraisal.
 */
@Controller('shop/trade-in')
@UseGuards(ShopBotDefenseGuard)
export class ShopTradeInController {
  constructor(private service: ShopTradeInService) {}

  @Post('estimate')
  estimate(@Body() dto: EstimateDto) {
    return this.service.estimate(dto);
  }

  @Post('submit')
  submit(@Body() dto: SubmitTradeInDto, @Req() req: Request & { user?: { sub?: string } }) {
    return this.service.submit(dto, req.user?.sub);
  }

  @Get(':id')
  getStatus(@Param('id') id: string) {
    return this.service.getStatus(id);
  }
}
