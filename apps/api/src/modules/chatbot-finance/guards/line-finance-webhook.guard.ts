import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { Request } from 'express';

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
      this.logger.warn('LINE_FINANCE_CHANNEL_SECRET not configured — skipping verification (DEV ONLY)');
      return true;
    }

    const signature = request.headers['x-line-signature'] as string | undefined;
    if (!signature) {
      this.logger.warn('Missing x-line-signature header');
      throw new UnauthorizedException('Missing LINE signature');
    }

    const body = JSON.stringify(request.body);
    const expected = createHmac('SHA256', this.channelSecret).update(body).digest('base64');

    if (signature !== expected) {
      this.logger.warn('Invalid LINE Finance webhook signature');
      throw new UnauthorizedException('Invalid LINE signature');
    }
    return true;
  }
}
