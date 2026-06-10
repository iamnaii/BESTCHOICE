import { BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SendNotificationDto } from '../dto/create-notification.dto';
import type { LineChannelKey } from '../dto/create-notification.dto';
import { NotificationChannel } from '@prisma/client';
import { FlexMessagePayload } from '../../line-oa/flex-messages/base-template';
import { ComplianceService } from '../compliance.service';
import { NotificationCategory } from '../notification-category.enum';
import { NotificationTemplateService } from '../notification-template.service';
import { readBoolFlag } from '../../../utils/config.util';
import * as Sentry from '@sentry/nestjs';
import { NotificationTransportService } from './notification-transport.service';

/**
 * Notification dispatch hub — owns `send()` (the IN_APP kill-switch gate, the
 * P2 compliance gate, the retry loop + SMS fallback), `sendFromTemplate`,
 * `sendBulk`, the persistent retry-queue (`markForRetry` / `processRetryQueue`),
 * and the placeholder substitution helpers.
 *
 * Plain class (not @Injectable) — constructed internally by NotificationsService.
 */
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private transport: NotificationTransportService,
    private prisma: PrismaService,
    private compliance: ComplianceService,
    private templateService: NotificationTemplateService,
  ) {}

  /**
   * Send a notification via LINE, SMS, or IN_APP with retry support
   *
   * **D1.3.1.4 — IN_APP channel gate:** when SystemConfig key
   * `in_app_notifications_enabled` is `'false'`, IN_APP calls silently
   * resolve with `{ id: '', status: 'SKIPPED', blockReason: 'IN_APP_DISABLED' }`
   * — NO exception, NO DB write. Cron jobs + transactional flows that
   * blindly `await notifications.send(...)` will continue without
   * disruption. LINE/SMS are unaffected.
   */
  async send(dto: SendNotificationDto): Promise<{ id: string; status: string; errorMsg?: string; blockReason?: string }> {
    // CRITICAL: IN_APP gate MUST remain at top of send() — before LINE/SMS channel
    // validators, before compliance gating, before any DB writes. Refactoring this
    // lower silently regresses the master toggle: cron jobs calling send({channel:'IN_APP'})
    // would burn a NotificationLog row even when the gate is OFF.
    // See PR #949 (D1.3.1.4) for context.
    //
    // D1.3.1.4 — IN_APP kill switch. Default ON (silent pass-through when
    // key missing/malformed). We read SystemConfig directly here to keep
    // NotificationsService independent of SettingsModule (avoids a wide DI
    // expansion just to read one boolean). Same pattern as PR #884.
    if (dto.channel === 'IN_APP') {
      const inAppEnabled = await readBoolFlag(this.prisma, 'in_app_notifications_enabled', true);
      if (!inAppEnabled) {
        return { id: '', status: 'SKIPPED', blockReason: 'IN_APP_DISABLED' };
      }
    }

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

    // Ensure DUNNING messages carry the [BESTCHOICE FINANCE] identification
    // prefix per พ.ร.บ.การทวงถามหนี้ มาตรา 8. Auto-prepends + Sentry-warns
    // when the upstream template forgot. Also scan for forbidden content
    // (threats/insults/profanity) per มาตรา 11 — Sentry-warns only, does
    // NOT block delivery (manual review pattern).
    let messageToSend = dto.message;
    if (dto.category === NotificationCategory.DUNNING) {
      messageToSend = this.compliance.ensureIdentificationPrefix(
        dto.message,
        dto.category,
      );
      // Derive dunning stage from subject (e.g. "Dunning: LEGAL_ACTION") so
      // the legal-threat pattern is only allowed when staff is sending an
      // actual LEGAL_ACTION-stage message.
      const stageMatch = dto.subject?.match(/Dunning:\s*(\w+)/);
      const dunningStage = stageMatch?.[1];
      this.compliance.scanForbiddenContent(messageToSend, dunningStage);
    }

    let status = 'PENDING';
    let errorMsg: string | null = null;
    let sentAt: Date | null = null;
    let externalId: string | null = null;
    let retryCount = 0;
    const maxRetries = 2;

    const attemptSend = async (): Promise<void> => {
      if (dto.channel === 'LINE') {
        await this.transport.sendLine(dto.recipient, messageToSend, channelKey);
      } else if (dto.channel === 'SMS') {
        const messageId = await this.transport.sendSms(dto.recipient, messageToSend);
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
              const fallbackMsgId = await this.transport.sendSms(dto.fallbackPhone, messageToSend);
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
        // Persist the prefixed message so audit trail matches what was
        // actually delivered to the customer.
        message: messageToSend,
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
   * Replace ${placeholders} in a string with data values.
   * Matches NotificationTemplateService syntax (${var}). Unknown vars are
   * left in their original ${var} form so reviewers spot them in logs.
   */
  private replacePlaceholders(text: string, data: Record<string, string>): string {
    return text.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
      const trimmed = varName.trim();
      return data[trimmed] ?? `\${${trimmed}}`;
    });
  }

  /**
   * Replace ${placeholders} in a JSON object recursively
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
   * Send notification from a NotificationTemplate keyed by eventType.
   *
   * Phase 7 (P3): looks up via NotificationTemplateService (DB-backed
   * NotificationTemplate model). Hard-fails with Sentry if template missing
   * (was: NotFoundException with no Sentry signal). Inactive templates
   * return BLOCKED with TEMPLATE_INACTIVE reason and Sentry warn.
   *
   * Template carries channel/channelKey/category — caller no longer offloads.
   */
  async sendFromTemplate(
    eventType: string,
    data: Record<string, string>,
    recipient: string,
    options: {
      relatedId?: string;
      customerId?: string;
      bypassCompliance?: boolean;
      fallbackPhone?: string;
    } = {},
  ): Promise<{ id: string | null; status: string; blockReason?: string }> {
    const tpl = await this.templateService.findByEventType(eventType);

    if (!tpl) {
      Sentry.captureMessage(`Notification template missing: ${eventType}`, {
        level: 'error',
        tags: { module: 'notifications', eventType },
        fingerprint: ['template-missing', eventType],
      });
      throw new InternalServerErrorException(`Notification template not found: ${eventType}`);
    }

    if (!tpl.isActive) {
      this.logger.warn(`Template ${eventType} is inactive — send blocked`);
      Sentry.captureMessage(`Notification template inactive: ${eventType}`, {
        level: 'warning',
        tags: { module: 'notifications', eventType },
        fingerprint: ['template-inactive', eventType],
      });
      return { id: null, status: 'BLOCKED', blockReason: 'TEMPLATE_INACTIVE' };
    }

    const message = this.replacePlaceholders(tpl.messageTemplate, data);

    // For Flex templates with channel=LINE, render JSON and send via lineOaService
    if (tpl.format === 'flex' && tpl.flexTemplate && tpl.channel === 'LINE' && tpl.channelKey) {
      try {
        const flexJson = JSON.parse(tpl.flexTemplate);
        const resolvedFlex = this.replacePlaceholdersInJson(flexJson, data) as FlexMessagePayload;
        await this.transport.sendLineFlexMessage(recipient, resolvedFlex, tpl.channelKey as LineChannelKey);

        // Mirror to staff inbox: create a ChatMessage so the staff sees what
        // the customer received. Best-effort — failures here must not break
        // the notification send.
        if (options.customerId) {
          try {
            const channel = tpl.channelKey === 'line-shop' ? 'LINE_SHOP' : 'LINE_FINANCE';
            const room = await this.prisma.chatRoom.findFirst({
              where: {
                customerId: options.customerId,
                channel: channel as 'LINE_SHOP' | 'LINE_FINANCE',
                deletedAt: null,
              },
              orderBy: { lastMessageAt: 'desc' },
            });
            if (room) {
              await this.prisma.chatMessage.create({
                data: {
                  roomId: room.id,
                  role: 'STAFF',
                  type: 'TEMPLATE',
                  text: message,
                  flexJson: resolvedFlex as object,
                  deliveredAt: new Date(),
                },
              });
            }
          } catch (mirrorErr) {
            this.logger.warn(
              `Failed to mirror Flex to ChatMessage for ${eventType}: ${
                mirrorErr instanceof Error ? mirrorErr.message : mirrorErr
              }`,
            );
          }
        }

        const log = await this.prisma.notificationLog.create({
          data: {
            channel: 'LINE',
            channelKey: tpl.channelKey,
            recipient,
            subject: tpl.subject ?? tpl.name,
            message: `Flex: ${message}`,
            status: 'SENT',
            relatedId: options.relatedId ?? null,
            customerId: options.customerId ?? null,
            category: tpl.category,
            blockReason: null,
            sentAt: new Date(),
          },
        });
        return { id: log.id, status: 'SENT' };
      } catch (err) {
        this.logger.warn(
          `Flex template send failed for ${eventType}, falling back to text: ${err instanceof Error ? err.message : err}`,
        );
        // Fall through to text send below
      }
    }

    // Text path (default)
    return this.send({
      channel: tpl.channel,
      channelKey: tpl.channelKey as LineChannelKey | undefined,
      recipient,
      subject: tpl.subject ?? tpl.name,
      message,
      relatedId: options.relatedId,
      customerId: options.customerId,
      category: tpl.category,
      bypassCompliance: options.bypassCompliance,
      fallbackPhone: options.fallbackPhone,
    });
  }

  /**
   * Bulk send notifications to multiple contracts.
   * @param eventType — NotificationTemplate.eventType (e.g. 'dunning.line.text.t-3').
   *   Template carries channel/channelKey/category — no longer caller-passed.
   */
  async sendBulk(eventType: string, contractIds: string[]) {
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

      const result = await this.sendFromTemplate(eventType, data, recipient, {
        relatedId: contractId,
        customerId: customer.id,
      });
      results.push({ contractId, status: result.status });
    }

    return { total: contractIds.length, results };
  }

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

    // Expire DELAYED rows older than 24h to FAILED. Without this they would
    // orphan silently in DELAYED forever (the findMany below filters by
    // createdAt >= 24h ago, so old rows would never re-enter the queue).
    const retryWindowCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.prisma.notificationLog.updateMany({
      where: { status: 'DELAYED', createdAt: { lt: retryWindowCutoff } },
      data: {
        status: 'FAILED',
        errorMsg: 'retry window expired (>24h DELAYED)',
        nextRetryAt: null,
      },
    });

    const pendingRetries = await this.prisma.notificationLog.findMany({
      where: {
        status: { in: ['RETRY_PENDING', 'DELAYED'] },
        nextRetryAt: { lte: now },
        createdAt: { gte: retryWindowCutoff },
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
          await this.transport.sendLine(notification.recipient, notification.message, channelKey);
        } else if (notification.channel === 'SMS') {
          await this.transport.sendSms(notification.recipient, notification.message);
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
}
