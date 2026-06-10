import { BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { maskPhone } from '../../../utils/mask.util';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import type { LineChannelKey } from '../dto/create-notification.dto';
import { FlexMessagePayload } from '../../line-oa/flex-messages/base-template';
import { IntegrationConfigService } from '../../integrations/integration-config.service';

/**
 * Shared transport core for the notifications module — owns the LINE/SMS
 * provider credentials + the raw delivery calls (LINE push, LINE flex push,
 * ThaiBulkSMS send), the Thai-phone formatter, the SMS credit check, the SMS
 * delivery-report webhook handler, and the public queue wrappers.
 *
 * Plain class (not @Injectable) — constructed internally by NotificationsService.
 */
export class NotificationTransportService {
  private readonly logger = new Logger(NotificationTransportService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private integrationConfig: IntegrationConfigService,
  ) {}

  async getLineToken(channelKey: LineChannelKey): Promise<string> {
    return (await this.integrationConfig.getValue(channelKey, 'channelToken')) || '';
  }

  async getSmsApiKey(): Promise<string> {
    return (await this.integrationConfig.getValue('sms', 'apiKey')) || '';
  }

  async getSmsApiSecret(): Promise<string> {
    return (await this.integrationConfig.getValue('sms', 'apiSecret')) || '';
  }

  async getSmsSender(): Promise<string> {
    return (await this.integrationConfig.getValue('sms', 'sender')) || 'BESTCHOICE';
  }

  async getSmsForce(): Promise<string> {
    return (await this.integrationConfig.getValue('sms', 'force')) || 'standard';
  }

  /**
   * Send LINE message via LINE Messaging API (Push Message)
   */
  async sendLine(recipient: string, message: string, channelKey: LineChannelKey): Promise<void> {
    const lineChannelAccessToken = await this.getLineToken(channelKey);
    if (!lineChannelAccessToken) {
      throw new BadRequestException('LINE channel access token not configured');
    }

    const url = 'https://api.line.me/v2/bot/message/push';
    const body = {
      to: recipient,
      messages: [{ type: 'text', text: message }],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lineChannelAccessToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`LINE API error ${response.status}: ${errorBody}`);
    }

    this.logger.log(`[LINE] Message sent to ${recipient}`);
  }

  /**
   * Send a LINE Flex Message via LINE Messaging API (Push Message)
   */
  async sendLineFlexMessage(recipient: string, flexMessage: FlexMessagePayload, channelKey: LineChannelKey): Promise<void> {
    const lineChannelAccessToken = await this.getLineToken(channelKey);
    if (!lineChannelAccessToken) {
      throw new BadRequestException('LINE channel access token not configured');
    }

    const url = 'https://api.line.me/v2/bot/message/push';
    const body = {
      to: recipient,
      messages: [flexMessage],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lineChannelAccessToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`LINE API error ${response.status}: ${errorBody}`);
    }

    this.logger.log(`[LINE] Flex message sent to ${recipient}`);
  }

  /** Public wrapper for queue worker to send SMS */
  async sendSmsFromQueue(recipient: string, message: string): Promise<string | undefined> {
    return this.sendSms(recipient, message);
  }

  /** Public wrapper for queue worker to send a LINE push (defaults to the finance OA) */
  async sendLineFromQueue(
    recipient: string,
    message: string,
    channelKey: LineChannelKey = 'line-finance',
  ): Promise<void> {
    return this.sendLine(recipient, message, channelKey);
  }

  /**
   * Send SMS via ThaiBulkSMS API V2
   * Docs: https://assets.thaibulksms.com/documents/ThaibulksmsAPIDocument_V2.0_EN.pdf
   */
  async sendSms(recipient: string, message: string): Promise<string | undefined> {
    // In non-production, skip actual SMS sending
    if (this.configService.get('NODE_ENV') !== 'production') {
      this.logger.warn(`[SMS-DEV] Skipping real SMS to ${maskPhone(recipient)} (${message.length} chars)`);
      return undefined;
    }

    const smsApiKey = await this.getSmsApiKey();
    const smsApiSecret = await this.getSmsApiSecret();

    if (!smsApiKey || !smsApiSecret) {
      throw new BadRequestException('SMS API key/secret not configured. Set SMS_API_KEY and SMS_API_SECRET in .env');
    }

    // Clean phone number: ensure 66XXXXXXXXX format for Thai numbers
    const cleanPhone = this.formatThaiPhone(recipient);

    // ThaiBulkSMS API V2 — Basic Auth + JSON response
    const url = 'https://api-v2.thaibulksms.com/sms';
    const basicAuth = Buffer.from(`${smsApiKey}:${smsApiSecret}`).toString('base64');
    const params = new URLSearchParams({
      msisdn: cleanPhone,
      message,
      sender: await this.getSmsSender(),
      force: await this.getSmsForce(),
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const responseText = await response.text();

    if (!response.ok) {
      if (response.status === 401) {
        throw new BadRequestException('SMS credentials invalid (401). Check SMS_API_KEY and SMS_API_SECRET.');
      }
      // Try to extract detailed error from JSON response
      let errorDetail = `ThaiBulkSMS HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(responseText);
        if (errorJson.error) {
          errorDetail = `ThaiBulkSMS error: ${errorJson.error.message || errorJson.error.code || JSON.stringify(errorJson.error)}`;
        }
      } catch { /* use raw text */ }
      throw new InternalServerErrorException(`${errorDetail}: ${responseText.substring(0, 300)}`);
    }

    // Parse JSON response from ThaiBulkSMS API V2
    let result: Record<string, unknown> | undefined;
    try {
      result = JSON.parse(responseText);
    } catch {
      // Non-JSON but HTTP 200 — log warning but treat as success
      this.logger.warn(`[SMS] Non-JSON 200 response: ${responseText.substring(0, 200)}`);
    }

    if (result) {
      // Check top-level error
      if (result.error) {
        const err = result.error as Record<string, string>;
        throw new InternalServerErrorException(`ThaiBulkSMS API error: ${err.message || err.code || JSON.stringify(result.error)}`);
      }

      // Check if our number ended up in the invalid list
      const data = result.data as Record<string, unknown> | undefined;
      if (data?.invalid_numbers && Array.isArray(data.invalid_numbers) && data.invalid_numbers.length > 0) {
        const invalidEntry = data.invalid_numbers.find(
          (n: Record<string, string>) => n.msisdn === cleanPhone,
        ) || data.invalid_numbers[0];
        throw new BadRequestException(
          `SMS number invalid for ${cleanPhone}: ${(invalidEntry as Record<string, string>)?.error_message || 'rejected by provider'}`,
        );
      }

      // Verify at least one successful number if the field exists
      if (data?.successful_numbers !== undefined && Array.isArray(data.successful_numbers) && data.successful_numbers.length === 0) {
        throw new InternalServerErrorException(`ThaiBulkSMS: no numbers were successfully queued. Response: ${JSON.stringify(data).substring(0, 300)}`);
      }
    }

    // Extract message_id from response for delivery tracking
    let messageId: string | undefined;
    const phoneList = result?.phone_number_list as Array<{ message_id?: string }> | undefined;
    if (Array.isArray(phoneList) && phoneList.length > 0 && phoneList[0].message_id) {
      messageId = phoneList[0].message_id;
    }

    this.logger.log(`[SMS] Message sent to ${cleanPhone}${messageId ? ` (message_id: ${messageId})` : ''}`);
    return messageId;
  }

  /**
   * Check ThaiBulkSMS credit balance
   * Returns credit info or error if not configured
   */
  async checkSmsCredit(): Promise<{ configured: boolean; credit?: number; error?: string }> {
    const smsApiKey = await this.getSmsApiKey();
    const smsApiSecret = await this.getSmsApiSecret();

    if (!smsApiKey || !smsApiSecret) {
      return { configured: false, error: 'SMS_API_KEY and SMS_API_SECRET not set in .env' };
    }

    try {
      const basicAuth = Buffer.from(`${smsApiKey}:${smsApiSecret}`).toString('base64');
      const response = await fetch('https://api-v2.thaibulksms.com/credit', {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Basic ${basicAuth}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await response.json() as Record<string, unknown>;

      if (!response.ok || data.error) {
        const err = data.error as Record<string, string> | undefined;
        return { configured: true, error: err?.description || err?.message || `HTTP ${response.status}` };
      }

      const remaining = data.remaining_credit as Record<string, number> | undefined;
      const credit = remaining?.standard ?? (data as Record<string, number>).credit_remain ?? 0;
      return { configured: true, credit };
    } catch (err) {
      return { configured: true, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  /**
   * Handle SMS delivery report webhook from ThaiBulkSMS
   * Updates NotificationLog with delivery status
   */
  async handleSmsDeliveryReport(body: Record<string, unknown>): Promise<{ received: boolean }> {
    const messageId = (body.message_id || body.messageId || body.id) as string | undefined;
    const dlrStatus = (body.status || body.delivery_status) as string | undefined;

    const safeFields = { message_id: messageId, status: dlrStatus };
    this.logger.log(`[SMS-DLR] Received: ${JSON.stringify(safeFields)}`);

    if (!messageId) {
      this.logger.warn('[SMS-DLR] No message_id in delivery report');
      return { received: true };
    }

    const log = await this.prisma.notificationLog.findFirst({
      where: { externalId: messageId },
    });

    if (!log) {
      this.logger.warn(`[SMS-DLR] No notification log found for message_id: ${messageId}`);
      return { received: true };
    }

    const deliveryStatus = dlrStatus?.toUpperCase() || 'UNKNOWN';
    const isDelivered = ['DELIVERED', 'SUCCESS', 'SENT'].includes(deliveryStatus);

    await this.prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        deliveryStatus,
        ...(isDelivered ? { deliveredAt: new Date() } : {}),
      },
    });

    this.logger.log(`[SMS-DLR] Updated log ${log.id}: deliveryStatus=${deliveryStatus}`);
    return { received: true };
  }

  /**
   * Format Thai phone number to international format (66XXXXXXXXX)
   */
  formatThaiPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    let formatted: string;
    if (cleaned.startsWith('0')) {
      formatted = '66' + cleaned.substring(1);
    } else if (cleaned.startsWith('66')) {
      formatted = cleaned;
    } else {
      formatted = cleaned;
    }

    // Thai mobile: 66XXXXXXXXX = 11 digits, landline: 66XXXXXXXX = 10 digits
    if (formatted.length < 10 || formatted.length > 12) {
      throw new BadRequestException(`Invalid phone number format: ${phone} (formatted: ${formatted})`);
    }
    return formatted;
  }
}
