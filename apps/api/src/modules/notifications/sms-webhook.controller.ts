import { Controller, Post, Get, Body, Query, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { NotificationsService } from './notifications.service';

/**
 * Public webhook endpoint for ThaiBulkSMS delivery reports (DLR).
 *
 * SECURITY: ThaiBulkSMS does not currently provide HMAC signing on
 * delivery reports, so we have no way to authenticate the caller.
 * Mitigations:
 *   1. Strict per-IP rate limit (60/min) to prevent log flooding by
 *      arbitrary attackers crafting fake DLRs.
 *   2. handleSmsDeliveryReport upstream is idempotent: it looks up
 *      a real notification log row by externalId and only updates
 *      its status. Unknown IDs are ignored, so a fake DLR cannot
 *      create new state — only modify a row that already exists.
 *
 * If ThaiBulkSMS adds HMAC support in the future, replace the
 * Throttle with an HMAC verification guard.
 */
@ApiTags('Notifications')
@Controller('notifications')
export class SmsWebhookController {
  private readonly logger = new Logger(SmsWebhookController.name);

  constructor(private notificationsService: NotificationsService) {}

  @Get('sms-webhook')
  @SkipCsrf()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async handleDeliveryReportGet(@Query() query: Record<string, unknown>) {
    this.logger.log(`[SMS-Webhook] Delivery report received (GET)`);
    try {
      return await this.notificationsService.handleSmsDeliveryReport(query);
    } catch (err) {
      this.logger.error(`[SMS-Webhook] handler error: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { module: 'sms-webhook', method: 'GET' } });
      return { ok: false };
    }
  }

  @Post('sms-webhook')
  @SkipCsrf()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async handleDeliveryReportPost(@Body() body: Record<string, unknown>) {
    this.logger.log(`[SMS-Webhook] Delivery report received (POST)`);
    try {
      return await this.notificationsService.handleSmsDeliveryReport(body);
    } catch (err) {
      this.logger.error(`[SMS-Webhook] handler error: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { module: 'sms-webhook', method: 'POST' } });
      return { ok: false };
    }
  }
}
