import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ShopTrackingService } from './shop-tracking.service';
import { TrackVisitDto } from './dto/track-visit.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

@Controller('shop')
@UseGuards(ShopBotDefenseGuard)
export class ShopTrackingController {
  constructor(private trackingService: ShopTrackingService) {}

  @Post('track')
  @Throttle({ short: { limit: 30, ttl: 60_000 } })
  async track(@Body() dto: TrackVisitDto, @Req() req: Request): Promise<{ ok: true }> {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    const customerId = (req as Request & { user?: { id: string } }).user?.id;

    await this.trackingService.recordVisit({
      sessionId: dto.sessionId,
      ip,
      userAgent,
      pagePath: dto.pagePath,
      referrer: dto.referrer,
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      durationSec: dto.durationSec,
      customerId,
    });

    return { ok: true };
  }
}
