import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { RawBodyRequest } from '../../../common/types/raw-body-request';

/**
 * Verify LINE webhook signature สำหรับ Finance OA
 * ใช้ secret คนละตัวกับ Shop OA — env: LINE_FINANCE_CHANNEL_SECRET
 */
@Injectable()
export class LineFinanceWebhookGuard implements CanActivate {
  private readonly logger = new Logger(LineFinanceWebhookGuard.name);
  private readonly channelSecret: string | undefined;

  constructor(private configService: ConfigService) {
    this.channelSecret = this.configService.get<string>('LINE_FINANCE_CHANNEL_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!this.channelSecret) {
      // SECURITY: dev-only bypass. In production, missing secret = hard
      // refusal — otherwise an attacker could replay any "LINE webhook"
      // and we would accept it.
      const isDev = process.env.NODE_ENV !== 'production';
      if (isDev) {
        this.logger.warn('LINE_FINANCE_CHANNEL_SECRET not configured — skipping verification (DEV ONLY)');
        return true;
      }
      this.logger.error('LINE_FINANCE_CHANNEL_SECRET missing in production — refusing webhook');
      throw new UnauthorizedException('Webhook signature verification not configured');
    }

    const signature = request.headers['x-line-signature'] as string | undefined;
    if (!signature) {
      this.logger.warn('Missing x-line-signature header');
      throw new UnauthorizedException('Missing LINE signature');
    }

    // Use raw body bytes for HMAC — JSON.stringify may differ from LINE's original payload
    const rawBody = (request as unknown as RawBodyRequest).rawBody;
    if (!rawBody) {
      const isDev = process.env.NODE_ENV !== 'production';
      if (!isDev) {
        this.logger.error('rawBody missing in production — refusing webhook');
        throw new UnauthorizedException('Cannot verify webhook signature without rawBody');
      }
      this.logger.warn('rawBody missing — falling back to JSON.stringify (DEV ONLY)');
    }
    const body = rawBody ?? Buffer.from(JSON.stringify(request.body));
    const expected = createHmac('SHA256', this.channelSecret).update(body).digest('base64');

    const sigBuf = Buffer.from(signature, 'base64');
    const expBuf = Buffer.from(expected, 'base64');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      this.logger.warn('Invalid LINE Finance webhook signature');
      throw new UnauthorizedException('Invalid LINE signature');
    }
    return true;
  }
}
