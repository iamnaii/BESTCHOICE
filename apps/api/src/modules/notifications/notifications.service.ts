import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { formatDateShort, formatDateTime } from '../../utils/thai-date.util';
import { maskPhone } from '../../utils/mask.util';
import { isSmsPaymentReminderDisabled } from '../../utils/sms-payment-reminder.util';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SendNotificationDto, CreateNotificationTemplateDto, UpdateNotificationTemplateDto } from './dto/create-notification.dto';
import type { LineChannelKey } from './dto/create-notification.dto';
import { NotificationChannel } from '@prisma/client';
import { FlexMessagePayload } from '../line-oa/flex-messages/base-template';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { ComplianceService } from './compliance.service';
import { NotificationCategory } from './notification-category.enum';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private flexTemplates: FlexTemplatesService,
    private quickReplyService: QuickReplyService,
    private integrationConfig: IntegrationConfigService,
    private compliance: ComplianceService,
  ) {}

  private async getLineToken(channelKey: LineChannelKey): Promise<string> {
    return (await this.integrationConfig.getValue(channelKey, 'channelToken')) || '';
  }

  private async getSmsApiKey(): Promise<string> {
    return (await this.integrationConfig.getValue('sms', 'apiKey')) || '';
  }

  private async getSmsApiSecret(): Promise<string> {
    return (await this.integrationConfig.getValue('sms', 'apiSecret')) || '';
  }

  private async getSmsSender(): Promise<string> {
    return (await this.integrationConfig.getValue('sms', 'sender')) || 'BESTCHOICE';
  }

  private async getSmsForce(): Promise<string> {
    return (await this.integrationConfig.getValue('sms', 'force')) || 'standard';
  }

  // ============================================================
  // NOTIFICATION SENDING
  // ============================================================

  /**
   * Send a notification via LINE, SMS, or IN_APP with retry support
   */
  async send(dto: SendNotificationDto): Promise<{ id: string; status: string; errorMsg?: string; blockReason?: string }> {
    // LINE channel requires explicit channelKey — backward-compat default
    // ('line-finance') was removed in Phase 7 once all callers were updated.
    // DTO validator enforces this at the HTTP boundary; this guard catches
    // direct service-to-service calls that bypass the validator.
    if (dto.channel === 'LINE' && !dto.channelKey) {
      throw new BadRequestException(
        'channelKey จำเป็นสำหรับ LINE notification (line-shop, line-finance, line-staff)',
      );
    }
    const channelKey = dto.channelKey as LineChannelKey;

    // ===== P2 Compliance gate =====
    // Only enforce when category provided AND channel is LINE/SMS
    // (IN_APP doesn't go to customer — staff-only context).
    if (dto.category && (dto.channel === 'LINE' || dto.channel === 'SMS')) {
      const result = await this.compliance.canSend({
        channel: dto.channel as NotificationChannel,
        customerId: dto.customerId,
        contractId: dto.relatedId,
        category: dto.category,
        bypassCompliance: dto.bypassCompliance,
      });

      if (!result.allowed) {
        // OUTSIDE_HOURS → DELAYED (will retry); other reasons → BLOCKED (final)
        const blockedStatus = result.reason === 'OUTSIDE_HOURS' ? 'DELAYED' : 'BLOCKED';
        const log = await this.prisma.notificationLog.create({
          data: {
            channel: dto.channel as NotificationChannel,
            channelKey: dto.channelKey ?? null,
            recipient: dto.recipient,
            subject: dto.subject,
            message: dto.message,
            status: blockedStatus,
            relatedId: dto.relatedId,
            customerId: dto.customerId ?? null,
            category: dto.category ?? null,
            blockReason: result.reason ?? null,
            errorMsg: blockedStatus === 'BLOCKED' ? `Compliance block: ${result.reason}` : null,
            sentAt: null,
            externalId: null,
            nextRetryAt: result.retryAfter ?? null,
          },
        });
        return { id: log.id, status: blockedStatus, blockReason: result.reason };
      }
    }
    // ===== End compliance gate =====

    let status = 'PENDING';
    let errorMsg: string | null = null;
    let sentAt: Date | null = null;
    let externalId: string | null = null;
    let retryCount = 0;
    const maxRetries = 2;

    const attemptSend = async (): Promise<void> => {
      if (dto.channel === 'LINE') {
        await this.sendLine(dto.recipient, dto.message, channelKey);
      } else if (dto.channel === 'SMS') {
        const messageId = await this.sendSms(dto.recipient, dto.message);
        if (messageId) externalId = messageId;
      }
      // IN_APP requires no external call
    };

    while (retryCount <= maxRetries) {
      try {
        await attemptSend();
        status = 'SENT';
        sentAt = new Date();
        break;
      } catch (err) {
        retryCount++;
        errorMsg = err instanceof Error ? err.message : 'Unknown error';

        // Skip retries for non-retryable errors
        const nonRetryable =
          errorMsg.includes('not configured') ||
          errorMsg.includes('credentials invalid') ||
          errorMsg.includes('number invalid') ||
          errorMsg.includes('Invalid phone number');

        if (!nonRetryable && retryCount <= maxRetries) {
          this.logger.warn(`Notification retry ${retryCount}/${maxRetries}: ${errorMsg}`);
          await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
        } else {
          status = 'FAILED';
          this.logger.error(`Notification failed after ${maxRetries} retries: ${errorMsg}`);

          // Fallback: if LINE failed, try SMS
          if (dto.channel === 'LINE' && dto.fallbackPhone) {
            this.logger.log(`Attempting SMS fallback for failed LINE notification`);
            try {
              const fallbackMsgId = await this.sendSms(dto.fallbackPhone, dto.message);
              if (fallbackMsgId) externalId = fallbackMsgId;
              status = 'SENT';
              sentAt = new Date();
              errorMsg = `LINE failed, sent via SMS fallback`;
            } catch (fallbackErr) {
              this.logger.error(`SMS fallback also failed: ${fallbackErr instanceof Error ? fallbackErr.message : 'Unknown'}`);
            }
          }
        }
      }
    }

    const log = await this.prisma.notificationLog.create({
      data: {
        channel: dto.channel as NotificationChannel,
        channelKey: dto.channelKey ?? null,
        recipient: dto.recipient,
        subject: dto.subject,
        message: dto.message,
        status,
        relatedId: dto.relatedId,
        customerId: dto.customerId ?? null,
        category: dto.category ?? null,
        blockReason: null,
        errorMsg,
        sentAt,
        externalId,
      },
    });

    // If failed, schedule for persistent retry queue — unless the caller
    // flagged the message as time-sensitive (e.g. OTP: the code expires in
    // 10 min, so retrying later is useless and spammy).
    if (status === 'FAILED' && dto.channel !== 'IN_APP' && !dto.noRetry) {
      await this.markForRetry(log.id, 0);
    }

    return { id: log.id, status, errorMsg: errorMsg ?? undefined };
  }

  /**
   * Send LINE message via LINE Messaging API (Push Message)
   */
  private async sendLine(recipient: string, message: string, channelKey: LineChannelKey): Promise<void> {
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
  private async sendLineFlexMessage(recipient: string, flexMessage: FlexMessagePayload, channelKey: LineChannelKey): Promise<void> {
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

  /**
   * Send SMS via ThaiBulkSMS API V2
   * Docs: https://assets.thaibulksms.com/documents/ThaibulksmsAPIDocument_V2.0_EN.pdf
   */
  private async sendSms(recipient: string, message: string): Promise<string | undefined> {
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
  private formatThaiPhone(phone: string): string {
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

  /**
   * Replace {placeholders} in a string with data values
   */
  private replacePlaceholders(text: string, data: Record<string, string>): string {
    let result = text;
    for (const [key, value] of Object.entries(data)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Replace {placeholders} in a JSON object recursively
   */
  private replacePlaceholdersInJson(obj: unknown, data: Record<string, string>): unknown {
    if (typeof obj === 'string') {
      return this.replacePlaceholders(obj, data);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.replacePlaceholdersInJson(item, data));
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replacePlaceholdersInJson(value, data);
      }
      return result;
    }
    return obj;
  }

  /**
   * Send notification using a template with data substitution
   * Supports both text and Flex Message JSON templates
   */
  async sendFromTemplate(
    templateId: string,
    data: Record<string, string>,
    recipient: string,
    relatedId?: string,
    options: { channelKey?: LineChannelKey; customerId?: string; category?: NotificationCategory } = {},
  ) {
    const template = await this.prisma.systemConfig.findFirst({
      where: { key: `notification_template_${templateId}`, deletedAt: null },
    });

    if (!template) throw new NotFoundException('ไม่พบ template');

    const templateData = JSON.parse(template.value);

    // Check if template is active
    if (templateData.isActive === false) {
      this.logger.warn(`Template ${templateId} is inactive, skipping`);
      return { id: null, status: 'SKIPPED', reason: 'Template is inactive' };
    }

    // Resolve channelKey: caller override > template-declared > legacy default.
    // Templates that don't declare a channelKey still default to line-finance
    // (preserves legacy behavior for HP/finance reminders) but callers sending
    // shop-side templates MUST pass options.channelKey = 'line-shop'.
    const resolvedChannelKey: LineChannelKey =
      options.channelKey ??
      (templateData.channelKey as LineChannelKey | undefined) ??
      'line-finance';

    // If format is 'flex' and channel is LINE, send as Flex Message
    if (templateData.format === 'flex' && templateData.channel === 'LINE' && templateData.flexTemplate) {
      try {
        const flexJson = JSON.parse(templateData.flexTemplate);
        const resolvedFlex = this.replacePlaceholdersInJson(flexJson, data) as FlexMessagePayload;
        await this.sendLineFlexMessage(recipient, resolvedFlex, resolvedChannelKey);

        const textSummary = this.replacePlaceholders(templateData.messageTemplate || templateData.name, data);
        const log = await this.prisma.notificationLog.create({
          data: {
            channel: 'LINE',
            channelKey: resolvedChannelKey,
            recipient,
            subject: templateData.subject || templateData.name,
            message: `Flex: ${textSummary}`,
            status: 'SENT',
            relatedId,
            sentAt: new Date(),
          },
        });

        return { id: log.id, status: 'SENT' };
      } catch (err) {
        this.logger.warn(`Flex template send failed, falling back to text: ${err instanceof Error ? err.message : err}`);
        // Fall through to text message
      }
    }

    let message = templateData.messageTemplate as string;
    message = this.replacePlaceholders(message, data);

    return this.send({
      channel: templateData.channel,
      channelKey: templateData.channel === 'LINE' ? resolvedChannelKey : undefined,
      recipient,
      subject: templateData.subject,
      message,
      relatedId,
      customerId: options.customerId,
      category: options.category ?? NotificationCategory.DUNNING,
    });
  }

  /**
   * Bulk send notifications to multiple contracts
   */
  async sendBulk(templateId: string, contractIds: string[]) {
    const results: { contractId: string; status: string }[] = [];

    // Batch load all contracts to avoid N+1 queries
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: contractIds }, deletedAt: null },
      include: { customer: { select: { id: true, name: true, phone: true, lineIdFinance: true } } },
    });
    const contractMap = new Map(contracts.map((c) => [c.id, c]));

    for (const contractId of contractIds) {
      const contract = contractMap.get(contractId);
      if (!contract) continue;

      const customer = contract.customer;
      const data: Record<string, string> = {
        customer_name: customer.name,
        contract_number: contract.contractNumber,
      };

      const recipient = customer.lineIdFinance || customer.phone;
      if (!recipient) {
        results.push({ contractId, status: 'SKIPPED' });
        continue;
      }

      const result = await this.sendFromTemplate(templateId, data, recipient, contractId, {
        customerId: customer.id,
        category: NotificationCategory.DUNNING,
      });
      results.push({ contractId, status: result.status });
    }

    return { total: contractIds.length, results };
  }

  // ============================================================
  // NOTIFICATION RETRY QUEUE
  // ============================================================

  /**
   * Mark failed notification for retry with exponential backoff.
   * Max 5 retries: 5m, 15m, 45m, 2h, 6h
   */
  private async markForRetry(logId: string, retryCount: number) {
    const maxRetries = 5;
    if (retryCount >= maxRetries) {
      this.logger.warn(`Notification ${logId} exceeded max retries (${maxRetries}), marking as permanently failed`);
      await this.prisma.notificationLog.update({
        where: { id: logId },
        data: { status: 'FAILED' },
      });
      return;
    }

    // Exponential backoff: 5min * 3^retryCount
    const backoffMs = 5 * 60 * 1000 * Math.pow(3, retryCount);
    const nextRetryAt = new Date(Date.now() + backoffMs);

    await this.prisma.notificationLog.update({
      where: { id: logId },
      data: {
        status: 'RETRY_PENDING',
        retryCount: retryCount + 1,
        nextRetryAt,
      },
    });
  }

  /**
   * Process the retry queue: find RETRY_PENDING notifications whose
   * nextRetryAt has passed, and attempt to resend them.
   * Called by the scheduler cron job.
   */
  async processRetryQueue(): Promise<{ retried: number; succeeded: number; failed: number }> {
    const now = new Date();

    // Force-fail orphaned RETRY_PENDING without nextRetryAt
    await this.prisma.notificationLog.updateMany({
      where: { status: 'RETRY_PENDING', nextRetryAt: null },
      data: { status: 'FAILED', errorMsg: 'Orphaned retry record — no nextRetryAt set' },
    });

    const pendingRetries = await this.prisma.notificationLog.findMany({
      where: {
        status: { in: ['RETRY_PENDING', 'DELAYED'] },
        nextRetryAt: { lte: now },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { nextRetryAt: 'asc' },
      take: 50, // Process max 50 per batch to avoid blocking
    });

    let succeeded = 0;
    let failed = 0;

    for (const notification of pendingRetries) {
      // Re-check compliance for DELAYED items (was blocked due to time window).
      // If still outside hours, re-schedule; if now blocked for a different
      // reason (e.g. consent revoked), mark BLOCKED and stop retrying.
      if (notification.status === 'DELAYED' && notification.category) {
        const result = await this.compliance.canSend({
          channel: notification.channel,
          customerId: notification.customerId ?? undefined,
          contractId: notification.relatedId ?? undefined,
          category: notification.category as NotificationCategory,
        });
        if (!result.allowed) {
          if (result.reason === 'OUTSIDE_HOURS') {
            await this.prisma.notificationLog.update({
              where: { id: notification.id },
              data: {
                nextRetryAt: result.retryAfter ?? new Date(Date.now() + 60 * 60 * 1000),
              },
            });
          } else {
            await this.prisma.notificationLog.update({
              where: { id: notification.id },
              data: {
                status: 'BLOCKED',
                blockReason: result.reason ?? null,
                errorMsg: `Compliance block on retry: ${result.reason}`,
              },
            });
          }
          continue;
        }
      }

      try {
        if (notification.channel === 'LINE') {
          // Use the original channelKey persisted on the log so retries hit
          // the same OA the message was meant for. Falls back to line-finance
          // for legacy logs created before channel_key was added.
          const channelKey = (notification.channelKey as LineChannelKey) ?? 'line-finance';
          await this.sendLine(notification.recipient, notification.message, channelKey);
        } else if (notification.channel === 'SMS') {
          await this.sendSms(notification.recipient, notification.message);
        }
        // Mark as sent
        await this.prisma.notificationLog.update({
          where: { id: notification.id },
          data: { status: 'SENT', sentAt: now, errorMsg: null },
        });
        succeeded++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        this.logger.warn(`Retry failed for notification ${notification.id} (attempt ${notification.retryCount}): ${errorMsg}`);

        await this.prisma.notificationLog.update({
          where: { id: notification.id },
          data: { errorMsg },
        });

        // Schedule next retry or mark as permanently failed
        await this.markForRetry(notification.id, notification.retryCount);
        failed++;
      }
    }

    if (pendingRetries.length > 0) {
      this.logger.log(`Retry queue processed: ${succeeded} succeeded, ${failed} failed out of ${pendingRetries.length}`);
    }

    return { retried: pendingRetries.length, succeeded, failed };
  }

  // ============================================================
  // NOTIFICATION LOGS
  // ============================================================

  async findLogs(filters: { channel?: string; status?: string; relatedId?: string; limit?: number }) {
    const where: Record<string, unknown> = {};
    if (filters.channel) where.channel = filters.channel;
    if (filters.status) where.status = filters.status;
    if (filters.relatedId) where.relatedId = filters.relatedId;

    return this.prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filters.limit || 50, 100),
    });
  }

  async getLogStats() {
    const groups = await this.prisma.notificationLog.groupBy({
      by: ['channel', 'status'],
      where: { deletedAt: null, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      _count: { _all: true },
    });

    const empty = () => ({ total: 0, sent: 0, failed: 0, pending: 0 });
    const result = {
      line: empty(),
      sms: { ...empty(), creditRemaining: 0 },
      in_app: empty(),
    };

    for (const g of groups) {
      const key = (g.channel === 'IN_APP' ? 'in_app' : g.channel.toLowerCase()) as
        | 'line'
        | 'sms'
        | 'in_app';
      const bucket = result[key];
      if (!bucket) continue;
      const count = g._count._all;
      bucket.total += count;
      if (g.status === 'SENT') bucket.sent += count;
      else if (g.status === 'FAILED') bucket.failed += count;
      else bucket.pending += count;
    }

    // Add SMS credit (informational)
    try {
      const credit = await this.checkSmsCredit();
      result.sms.creditRemaining = credit.credit ?? 0;
    } catch {
      // ignore — credit check is informational
    }

    return result;
  }

  // ============================================================
  // NOTIFICATION TEMPLATES (stored in system_config)
  // ============================================================

  async findTemplates() {
    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: 'notification_template_' }, deletedAt: null },
      orderBy: { key: 'asc' },
    });

    return configs.map((c) => ({
      id: c.key.replace('notification_template_', ''),
      ...JSON.parse(c.value),
      updatedAt: c.updatedAt,
    }));
  }

  async findTemplate(id: string) {
    const config = await this.prisma.systemConfig.findFirst({
      where: { key: `notification_template_${id}`, deletedAt: null },
    });
    if (!config) throw new NotFoundException('ไม่พบ template');

    return {
      id,
      ...JSON.parse(config.value),
      updatedAt: config.updatedAt,
    };
  }

  async createTemplate(dto: CreateNotificationTemplateDto) {
    const id = dto.eventType.toLowerCase() + '_' + dto.channel.toLowerCase();

    const exists = await this.prisma.systemConfig.findFirst({
      where: { key: `notification_template_${id}`, deletedAt: null },
    });
    if (exists) {
      // Update existing
      return this.updateTemplate(id, {
        name: dto.name,
        format: dto.format,
        subject: dto.subject,
        messageTemplate: dto.messageTemplate,
        flexTemplate: dto.flexTemplate,
        description: dto.description,
      });
    }

    const templateValue: Record<string, unknown> = {
      name: dto.name,
      eventType: dto.eventType,
      channel: dto.channel,
      format: dto.format || 'text',
      subject: dto.subject,
      messageTemplate: dto.messageTemplate,
      description: dto.description,
      isActive: true,
    };
    if (dto.flexTemplate) {
      templateValue.flexTemplate = dto.flexTemplate;
    }

    const config = await this.prisma.systemConfig.create({
      data: {
        key: `notification_template_${id}`,
        value: JSON.stringify(templateValue),
        label: `Template: ${dto.name}`,
      },
    });

    return { id, ...JSON.parse(config.value) };
  }

  async updateTemplate(id: string, dto: UpdateNotificationTemplateDto) {
    const config = await this.prisma.systemConfig.findFirst({
      where: { key: `notification_template_${id}`, deletedAt: null },
    });
    if (!config) throw new NotFoundException('ไม่พบ template');

    const existing = JSON.parse(config.value);
    const updated = { ...existing };
    if (dto.name !== undefined) updated.name = dto.name;
    if (dto.format !== undefined) updated.format = dto.format;
    if (dto.subject !== undefined) updated.subject = dto.subject;
    if (dto.messageTemplate !== undefined) updated.messageTemplate = dto.messageTemplate;
    if (dto.flexTemplate !== undefined) updated.flexTemplate = dto.flexTemplate;
    if (dto.description !== undefined) updated.description = dto.description;
    if (dto.isActive !== undefined) updated.isActive = dto.isActive;

    await this.prisma.systemConfig.update({
      where: { key: `notification_template_${id}` },
      data: { value: JSON.stringify(updated) },
    });

    return { id, ...updated };
  }

  async deleteTemplate(id: string) {
    const config = await this.prisma.systemConfig.findFirst({
      where: { key: `notification_template_${id}`, deletedAt: null },
    });
    if (!config) throw new NotFoundException('ไม่พบ template');

    await this.prisma.systemConfig.update({
      where: { key: `notification_template_${id}` },
      data: { deletedAt: new Date() },
    });

    return { deleted: true };
  }

  // ============================================================
  // SCHEDULING (CRON-BASED)
  // ============================================================

  /**
   * Send payment reminders for upcoming due dates (run daily)
   * Sends reminders exactly 3 days and 1 day before due date
   */
  async sendPaymentReminders() {
    const now = new Date();
    const today = new Date(now.toISOString().split('T')[0]);

    // Fetch payments due in exactly 0 (today), 1, or 3 days (filter at DB level)
    const day0End = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const day1 = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000);
    const day1End = new Date(day1.getTime() + 24 * 60 * 60 * 1000);
    const day3 = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
    const day3End = new Date(day3.getTime() + 24 * 60 * 60 * 1000);

    const upcomingPayments = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        OR: [
          { dueDate: { gte: today, lt: day0End } },
          { dueDate: { gte: day1, lt: day1End } },
          { dueDate: { gte: day3, lt: day3End } },
        ],
        contract: { status: 'ACTIVE', deletedAt: null },
      },
      include: {
        contract: {
          include: {
            customer: { select: { id: true, name: true, phone: true, lineIdFinance: true } },
            _count: { select: { payments: true } },
          },
        },
      },
    });

    let sent = 0;
    for (const payment of upcomingPayments) {
      const customer = payment.contract.customer;
      const daysUntil = Math.max(
        0,
        Math.round((new Date(payment.dueDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
      );

      // Dedup: skip if already sent a reminder for this payment today
      const alreadySent = await this.prisma.notificationLog.findFirst({
        where: {
          relatedId: payment.id,
          subject: 'แจ้งเตือนค่างวด',
          sentAt: { gte: today },
        },
      });
      if (alreadySent) continue;

      // Check PDPA consent before sending notification
      const consent = await this.prisma.pDPAConsent.findFirst({
        where: {
          customerId: customer.id,
          status: 'GRANTED',
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!consent) {
        await this.prisma.notificationLog.create({
          data: {
            channel: 'IN_APP',
            recipient: customer.id,
            subject: 'แจ้งเตือนค่างวด',
            message: `ข้ามการแจ้งเตือน — ลูกค้าไม่มี PDPA consent`,
            status: 'SKIPPED',
            relatedId: payment.id,
          },
        });
        continue;
      }

      const message = `สวัสดีค่ะ คุณ${customer.name}\nแจ้งเตือน: ค่างวดที่ ${payment.installmentNo} สัญญา ${payment.contract.contractNumber}\nจำนวน ${Number(payment.amountDue).toLocaleString()} บาท\nครบกำหนดชำระ${daysUntil === 0 ? 'วันนี้' : `อีก ${daysUntil} วัน`} (${formatDateShort(payment.dueDate)})\nกรุณาชำระตามกำหนด ขอบคุณค่ะ`;

      // Try LINE Flex Message first, fallback to text, then SMS
      if (customer.lineIdFinance) {
        try {
          const flex = this.flexTemplates.paymentReminder({
            contractNumber: payment.contract.contractNumber,
            installmentNo: payment.installmentNo,
            amount: Number(payment.amountDue),
            dueDate: formatDateShort(payment.dueDate),
          });
          // Attach Quick Reply so customer can pay quickly or see balance
          flex.quickReply = { items: this.quickReplyService.afterPayment() };
          await this.sendLineFlexMessage(customer.lineIdFinance, flex, 'line-finance');
          await this.prisma.notificationLog.create({
            data: {
              channel: 'LINE',
              channelKey: 'line-finance',
              recipient: customer.lineIdFinance,
              subject: 'แจ้งเตือนค่างวด',
              message: `งวด ${payment.installmentNo} จำนวน ${Number(payment.amountDue).toLocaleString()} บาท อีก ${daysUntil} วัน`,
              status: 'SENT',
              relatedId: payment.id,
              sentAt: new Date(),
            },
          });
          sent++;
        } catch (err) {
          this.logger.warn(`Flex message failed, falling back to text: ${err instanceof Error ? err.message : err}`);
          await this.send({
            channel: 'LINE',
            channelKey: 'line-finance',
            recipient: customer.lineIdFinance,
            message,
            relatedId: payment.id,
            fallbackPhone: isSmsPaymentReminderDisabled() ? undefined : (customer.phone || undefined),
            customerId: customer.id,
            category: NotificationCategory.REMINDER,
          });
          sent++;
        }
      } else if (customer.phone) {
        if (isSmsPaymentReminderDisabled()) {
          this.logger.warn(`[SMS-REMINDER-OFF] Skipping payment reminder SMS for payment ${payment.id}`);
        } else {
          await this.send({
            channel: 'SMS',
            recipient: customer.phone,
            message,
            relatedId: payment.id,
            customerId: customer.id,
            category: NotificationCategory.REMINDER,
          });
          sent++;
        }
      }
    }

    this.logger.log(`Payment reminders sent: ${sent}/${upcomingPayments.length}`);
    return { sent, total: upcomingPayments.length, timestamp: now };
  }

  /**
   * Send overdue notices (run daily)
   * Sends notices exactly 1, 3, and 7 days after due date
   */
  async sendOverdueNotices() {
    const now = new Date();
    const today = new Date(now.toISOString().split('T')[0]);

    // Only fetch payments overdue by exactly 1, 3, or 7 days (filter at DB level)
    const dueDates = [1, 3, 7].map((days) => {
      const start = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      return { gte: start, lt: end };
    });

    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
        OR: dueDates.map((dueDate) => ({ dueDate })),
        contract: { status: { in: ['ACTIVE', 'OVERDUE'] }, deletedAt: null },
      },
      include: {
        contract: {
          include: {
            customer: { select: { id: true, name: true, phone: true, lineIdFinance: true } },
            _count: { select: { payments: true } },
          },
        },
      },
    });

    let sent = 0;
    for (const payment of overduePayments) {
      const customer = payment.contract.customer;
      const daysOverdue = Math.floor(
        (now.getTime() - new Date(payment.dueDate).getTime()) / (1000 * 60 * 60 * 24),
      );

      // Dedup: skip if already sent an overdue notice for this payment today
      const alreadySent = await this.prisma.notificationLog.findFirst({
        where: {
          relatedId: payment.id,
          subject: 'แจ้งค้างชำระ',
          sentAt: { gte: today },
        },
      });
      if (alreadySent) continue;

      // Check PDPA consent before sending notification
      const consent = await this.prisma.pDPAConsent.findFirst({
        where: {
          customerId: customer.id,
          status: 'GRANTED',
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!consent) {
        await this.prisma.notificationLog.create({
          data: {
            channel: 'IN_APP',
            recipient: customer.id,
            subject: 'แจ้งค้างชำระ',
            message: `ข้ามการแจ้งเตือน — ลูกค้าไม่มี PDPA consent`,
            status: 'SKIPPED',
            relatedId: payment.id,
          },
        });
        continue;
      }

      const outstanding = Number(payment.amountDue) - Number(payment.amountPaid) + Number(payment.lateFee);
      const message = `แจ้งเตือน: คุณ${customer.name}\nค่างวดที่ ${payment.installmentNo} สัญญา ${payment.contract.contractNumber}\nเลยกำหนดชำระ ${daysOverdue} วัน\nยอดค้างชำระ ${outstanding.toLocaleString()} บาท (รวมค่าปรับ)\nกรุณาชำระโดยเร็ว`;

      // Try LINE Flex Message first, fallback to text, then SMS
      if (customer.lineIdFinance) {
        try {
          const flex = this.flexTemplates.overdueNotice({
            contractNumber: payment.contract.contractNumber,
            overdueInstallments: daysOverdue,
            totalAmount: outstanding,
            lateFee: Number(payment.lateFee),
          });
          // Attach Quick Reply so customer can pay immediately or see balance
          flex.quickReply = { items: this.quickReplyService.afterPayment() };
          await this.sendLineFlexMessage(customer.lineIdFinance, flex, 'line-finance');
          await this.prisma.notificationLog.create({
            data: {
              channel: 'LINE',
              channelKey: 'line-finance',
              recipient: customer.lineIdFinance,
              subject: 'แจ้งค้างชำระ',
              message: `งวด ${payment.installmentNo} ค้าง ${outstanding.toLocaleString()} บาท เลยกำหนด ${daysOverdue} วัน`,
              status: 'SENT',
              relatedId: payment.id,
              sentAt: new Date(),
            },
          });
          sent++;
        } catch (err) {
          this.logger.warn(`Flex message failed, falling back to text: ${err instanceof Error ? err.message : err}`);
          await this.send({
            channel: 'LINE',
            channelKey: 'line-finance',
            recipient: customer.lineIdFinance,
            message,
            relatedId: payment.id,
            fallbackPhone: isSmsPaymentReminderDisabled() ? undefined : (customer.phone || undefined),
            customerId: customer.id,
            category: NotificationCategory.DUNNING,
          });
          sent++;
        }
      } else if (customer.phone) {
        if (isSmsPaymentReminderDisabled()) {
          this.logger.warn(`[SMS-REMINDER-OFF] Skipping overdue notice SMS for payment ${payment.id}`);
        } else {
          await this.send({
            channel: 'SMS',
            recipient: customer.phone,
            message,
            relatedId: payment.id,
            customerId: customer.id,
            category: NotificationCategory.DUNNING,
          });
          sent++;
        }
      }
    }

    this.logger.log(`Overdue notices sent: ${sent}/${overduePayments.length}`);
    return { sent, total: overduePayments.length, timestamp: now };
  }

  /**
   * Notify managers about overdue contracts (run daily)
   */
  async notifyManagersOverdue() {
    const overdueContracts = await this.prisma.contract.findMany({
      where: {
        status: 'OVERDUE',
        deletedAt: null,
      },
      include: {
        customer: { select: { name: true } },
        branch: {
          select: {
            id: true,
            name: true,
            users: {
              where: { role: 'BRANCH_MANAGER', isActive: true },
              select: { name: true, email: true },
            },
          },
        },
      },
    });

    let sent = 0;
    // Group by branch to send one summary per manager
    const branchGroups = new Map<string, { manager: { name: string; email: string }; contracts: string[] }>();
    for (const contract of overdueContracts) {
      for (const manager of contract.branch.users) {
        const key = manager.email;
        if (!branchGroups.has(key)) {
          branchGroups.set(key, { manager, contracts: [] });
        }
        branchGroups.get(key)!.contracts.push(
          `${contract.contractNumber}: ${contract.customer.name}`,
        );
      }
    }

    for (const [, { manager, contracts }] of branchGroups) {
      await this.send({
        channel: 'IN_APP',
        recipient: manager.email,
        subject: `สัญญาค้างชำระ ${contracts.length} รายการ`,
        message: `สัญญาค้างชำระที่ต้องติดตาม:\n${contracts.map((c) => `- ${c}`).join('\n')}`,
        category: NotificationCategory.STAFF,
      });
      sent++;
    }

    return { sent, contracts: overdueContracts.length };
  }

  /**
   * Notify owner about defaulted contracts (run daily)
   */
  async notifyOwnerDefault() {
    const defaultContracts = await this.prisma.contract.findMany({
      where: { status: 'DEFAULT', deletedAt: null },
      include: {
        customer: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });

    const owners = await this.prisma.user.findMany({
      where: { role: 'OWNER', isActive: true },
      select: { email: true, name: true },
    });

    let sent = 0;
    for (const owner of owners) {
      if (defaultContracts.length > 0) {
        const contractList = defaultContracts
          .map((c) => `- ${c.contractNumber}: ${c.customer.name} (${c.branch.name})`)
          .join('\n');

        await this.send({
          channel: 'IN_APP',
          recipient: owner.email,
          subject: `สัญญา DEFAULT ${defaultContracts.length} รายการ`,
          message: `สัญญาที่อยู่ในสถานะ DEFAULT:\n${contractList}`,
          category: NotificationCategory.STAFF,
        });
        sent++;
      }
    }

    return { sent, contracts: defaultContracts.length };
  }
}
