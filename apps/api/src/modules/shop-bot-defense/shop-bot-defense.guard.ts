import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ShopBotDefenseService } from './shop-bot-defense.service';
import { SKIP_BOT_RATE_LIMIT } from './skip-bot-rate-limit.decorator';

@Injectable()
export class ShopBotDefenseGuard implements CanActivate {
  constructor(
    private botDefense: ShopBotDefenseService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    // setGlobalPrefix('api') ทำให้ req.path เป็น /api/shop/... — ตัด prefix ออกก่อน
    // ไม่งั้นกฎที่จับ path สินค้าใน decideAction เป็น dead code (บั๊กเดิม)
    const pagePath = req.path.replace(/^\/api(?=\/|$)/, '') || '/';

    const requestRate = await this.botDefense.getRequestRate(ip);
    const action = this.botDefense.decideAction({ userAgent, requestRate, pagePath });

    const detectedType = this.botDefense.classifyUserAgent(userAgent) || 'GENERIC_BOT';
    void this.botDefense.logDetection({ ip, userAgent, pagePath, detectedType, action, signals: { requestRate } });
    void this.botDefense.recordRateLimit(ip, userAgent, pagePath);

    if (action === 'BLOCKED') {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const skipRateLimit = this.reflector.getAllAndOverride<boolean>(SKIP_BOT_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (action === 'RATE_LIMITED' && !skipRateLimit) {
      throw new HttpException({ message: 'Too many requests', retryAfter: 60 }, HttpStatus.TOO_MANY_REQUESTS);
    }
    // CAPTCHA_REQUIRED handled in next phase (Cloudflare Turnstile)
    return true;
  }
}
