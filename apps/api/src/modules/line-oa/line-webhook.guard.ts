import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { RawBodyRequest } from '../../common/types/raw-body-request';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';

/**
 * Guard for LINE Webhook signature verification
 * Verifies that incoming webhook requests are actually from LINE
 * using HMAC-SHA256 signature validation
 */
@Injectable()
export class LineWebhookGuard implements CanActivate {
  private readonly logger = new Logger(LineWebhookGuard.name);

  constructor(
    private integrationConfig: IntegrationConfigService,
    private anomaly: WebhookAnomalyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'] as string | undefined;

    const channelSecret = (await this.integrationConfig.getValue('line-shop', 'channelSecret')) || '';

    if (!channelSecret) {
      const isDev = process.env.NODE_ENV !== 'production';
      if (isDev) {
        this.logger.warn('LINE_CHANNEL_SECRET not configured — skipping verification (DEV ONLY)');
        return true;
      }
      this.logger.error('LINE_CHANNEL_SECRET missing in production — refusing webhook');
      void this.anomaly.record({ provider: 'line-shop', reason: 'missing_secret', ipAddress, userAgent });
      throw new UnauthorizedException('Webhook signature verification not configured');
    }

    const signature = request.headers['x-line-signature'] as string;

    if (!signature) {
      this.logger.warn('Missing x-line-signature header');
      void this.anomaly.record({ provider: 'line-shop', reason: 'missing_signature', ipAddress, userAgent });
      throw new UnauthorizedException('Missing LINE signature');
    }

    // Use raw body bytes for HMAC — JSON.stringify may differ from LINE's original payload
    const rawBody = (request as unknown as RawBodyRequest).rawBody;
    const body = rawBody ?? Buffer.from(JSON.stringify(request.body));
    const expectedSignature = createHmac('SHA256', channelSecret)
      .update(body)
      .digest('base64');

    const sigBuf = Buffer.from(signature, 'base64');
    const expBuf = Buffer.from(expectedSignature, 'base64');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      this.logger.warn('Invalid LINE webhook signature');
      void this.anomaly.record({ provider: 'line-shop', reason: 'invalid_signature', ipAddress, userAgent });
      throw new UnauthorizedException('Invalid LINE signature');
    }

    return true;
  }
}
