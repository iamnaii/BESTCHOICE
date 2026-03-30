import {
  Controller,
  Post,
  Body,
  Headers,
  Logger,
  UnauthorizedException,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { NotificationsService } from './notifications.service';

/**
 * Public webhook endpoint for ThaiBulkSMS delivery reports (DLR).
 * Verified via HMAC-SHA256 signature in X-Webhook-Signature header.
 *
 * To configure: set this URL as the callback_url in ThaiBulkSMS dashboard
 * or when sending SMS via API (if supported).
 * Example: https://your-domain.com/api/notifications/sms-webhook
 */
@Controller('notifications')
export class SmsWebhookController {
  private readonly logger = new Logger(SmsWebhookController.name);

  constructor(private notificationsService: NotificationsService) {}

  private verifySignature(rawBody: Buffer | string, signature: string): boolean {
    const secret = process.env.SMS_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.error('[SMS-Webhook] SMS_WEBHOOK_SECRET is not configured');
      return false;
    }

    const expectedSignature = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');

    if (sigBuf.length !== expectedBuf.length) {
      return false;
    }

    return timingSafeEqual(sigBuf, expectedBuf);
  }

  @Post('sms-webhook')
  async handleDeliveryReport(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (!signature) {
      this.logger.warn('[SMS-Webhook] Missing signature header');
      throw new UnauthorizedException('Missing webhook signature');
    }

    const rawBody = req.rawBody || JSON.stringify(body);
    if (!this.verifySignature(rawBody, signature)) {
      this.logger.warn('[SMS-Webhook] Invalid signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.logger.log(`[SMS-Webhook] Delivery report received (verified)`);
    return this.notificationsService.handleSmsDeliveryReport(body);
  }
}
