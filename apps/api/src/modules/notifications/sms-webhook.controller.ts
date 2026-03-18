import { Controller, Post, Body, Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/**
 * Public webhook endpoint for ThaiBulkSMS delivery reports (DLR).
 * No authentication — ThaiBulkSMS calls this URL with delivery status updates.
 *
 * To configure: set this URL as the callback_url in ThaiBulkSMS dashboard
 * or when sending SMS via API (if supported).
 * Example: https://your-domain.com/api/notifications/sms-webhook
 */
@Controller('notifications')
export class SmsWebhookController {
  private readonly logger = new Logger(SmsWebhookController.name);

  constructor(private notificationsService: NotificationsService) {}

  @Post('sms-webhook')
  async handleDeliveryReport(@Body() body: Record<string, unknown>) {
    this.logger.log(`[SMS-Webhook] Delivery report received`);
    return this.notificationsService.handleSmsDeliveryReport(body);
  }
}
