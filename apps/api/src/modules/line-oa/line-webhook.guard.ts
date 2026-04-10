import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { RawBodyRequest } from '../../common/types/raw-body-request';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Guard for LINE Webhook signature verification
 * Verifies that incoming webhook requests are actually from LINE
 * using HMAC-SHA256 signature validation
 */
@Injectable()
export class LineWebhookGuard implements CanActivate {
  private readonly logger = new Logger(LineWebhookGuard.name);
  private channelSecret: string | undefined;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.channelSecret = this.configService.get<string>('LINE_CHANNEL_SECRET');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Try loading from DB if not set via env
    if (!this.channelSecret) {
      try {
        const config = await this.prisma.systemConfig.findUnique({
          where: { key: 'line_channel_secret' },
        });
        if (config?.value) {
          this.channelSecret = config.value;
        }
      } catch {
        // DB not ready
      }
    }

    if (!this.channelSecret) {
      const isDev = process.env.NODE_ENV !== 'production';
      if (isDev) {
        this.logger.warn('LINE_CHANNEL_SECRET not configured — skipping verification (DEV ONLY)');
        return true;
      }
      this.logger.error('LINE_CHANNEL_SECRET missing in production — refusing webhook');
      throw new UnauthorizedException('Webhook signature verification not configured');
    }

    const signature = request.headers['x-line-signature'] as string;

    if (!signature) {
      this.logger.warn('Missing x-line-signature header');
      throw new UnauthorizedException('Missing LINE signature');
    }

    // Use raw body bytes for HMAC — JSON.stringify may differ from LINE's original payload
    const rawBody = (request as unknown as RawBodyRequest).rawBody;
    const body = rawBody ?? Buffer.from(JSON.stringify(request.body));
    const expectedSignature = createHmac('SHA256', this.channelSecret)
      .update(body)
      .digest('base64');

    const sigBuf = Buffer.from(signature, 'base64');
    const expBuf = Buffer.from(expectedSignature, 'base64');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      this.logger.warn('Invalid LINE webhook signature');
      throw new UnauthorizedException('Invalid LINE signature');
    }

    return true;
  }
}
