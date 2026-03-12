import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { Request } from 'express';

/**
 * Guard for LINE Webhook signature verification
 * Verifies that incoming webhook requests are actually from LINE
 * using HMAC-SHA256 signature validation
 */
@Injectable()
export class LineWebhookGuard implements CanActivate {
  private readonly logger = new Logger(LineWebhookGuard.name);
  private readonly channelSecret: string | undefined;

  constructor(private configService: ConfigService) {
    this.channelSecret = this.configService.get<string>('LINE_CHANNEL_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Skip verification in development if no secret is configured
    if (!this.channelSecret) {
      this.logger.warn('LINE_CHANNEL_SECRET not configured, skipping webhook verification');
      return true;
    }

    const signature = request.headers['x-line-signature'] as string;

    if (!signature) {
      this.logger.warn('Missing x-line-signature header');
      throw new UnauthorizedException('Missing LINE signature');
    }

    // The body must be the raw body string for signature verification
    const body = JSON.stringify(request.body);
    const expectedSignature = createHmac('SHA256', this.channelSecret)
      .update(body)
      .digest('base64');

    if (signature !== expectedSignature) {
      this.logger.warn('Invalid LINE webhook signature');
      throw new UnauthorizedException('Invalid LINE signature');
    }

    return true;
  }
}
