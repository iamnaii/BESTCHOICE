import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ShopBotDefenseService } from './shop-bot-defense.service';

@Injectable()
export class ShopBotDefenseGuard implements CanActivate {
  constructor(private botDefense: ShopBotDefenseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    const pagePath = req.path;

    const requestRate = await this.botDefense.getRequestRate(ip);
    const action = this.botDefense.decideAction({ userAgent, requestRate, pagePath });

    const detectedType = this.botDefense.classifyUserAgent(userAgent) || 'GENERIC_BOT';
    void this.botDefense.logDetection({ ip, userAgent, pagePath, detectedType, action, signals: { requestRate } });
    void this.botDefense.recordRateLimit(ip, userAgent, pagePath);

    if (action === 'BLOCKED') {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (action === 'RATE_LIMITED') {
      throw new HttpException({ message: 'Too many requests', retryAfter: 60 }, HttpStatus.TOO_MANY_REQUESTS);
    }
    // CAPTCHA_REQUIRED handled in next phase (Cloudflare Turnstile)
    return true;
  }
}
