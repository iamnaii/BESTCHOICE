import { Controller, Post, Get, Body, Query, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

/**
 * Public webhook endpoint for ThaiBulkSMS delivery reports (DLR).
 * No authentication — ThaiBulkSMS calls this URL with delivery status updates.
 *
 * Supports both GET (ThaiBulkSMS default) and POST methods.
 * Example: https://your-domain.com/api/notifications/sms-webhook
 */
@ApiTags('Notifications')
@Controller('notifications')
export class SmsWebhookController {
  private readonly logger = new Logger(SmsWebhookController.name);

  constructor(private notificationsService: NotificationsService) {}

  @Get('sms-webhook')
  async handleDeliveryReportGet(@Query() query: Record<string, unknown>) {
    this.logger.log(`[SMS-Webhook] Delivery report received (GET)`);
    return this.notificationsService.handleSmsDeliveryReport(query);
  }

  @Post('sms-webhook')
  async handleDeliveryReportPost(@Body() body: Record<string, unknown>) {
    this.logger.log(`[SMS-Webhook] Delivery report received (POST)`);
    return this.notificationsService.handleSmsDeliveryReport(body);
  }
}
