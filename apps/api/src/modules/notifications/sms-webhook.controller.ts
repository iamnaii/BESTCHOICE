import { Controller, Post, Get, Body, Query, Logger, Req, Res, HttpCode } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { NotificationsService } from './notifications.service';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';

/**
 * Public webhook endpoint for ThaiBulkSMS delivery reports (DLR).
 *
 * SECURITY: ThaiBulkSMS does not currently provide HMAC signing on
 * delivery reports, so we have no way to authenticate the caller.
 * Mitigations:
 *   1. Strict per-IP rate limit (60/min) to prevent log flooding by
 *      arbitrary attackers crafting fake DLRs.
 *   2. Optional IP allow-list via SMS_WEBHOOK_ALLOWED_IPS env var —
 *      comma-separated list of provider IPs. When set, only those IPs
 *      can POST/GET the webhook; all others get 403 + WebhookAnomaly row.
 *      When empty (dev), everything is allowed but a warning is logged so
 *      the operator knows the allow-list is missing.
 *   3. handleSmsDeliveryReport upstream is idempotent: it looks up
 *      a real notification log row by externalId and only updates
 *      its status. Unknown IDs are ignored, so a fake DLR cannot
 *      create new state — only modify a row that already exists.
 *
 * If ThaiBulkSMS adds HMAC support in the future, replace the
 * allow-list with an HMAC verification guard.
 */
@ApiTags('Notifications')
@Controller('notifications')
export class SmsWebhookController {
  private readonly logger = new Logger(SmsWebhookController.name);
  private loggedMissingAllowList = false;

  constructor(
    private notificationsService: NotificationsService,
    private anomaly: WebhookAnomalyService,
  ) {}

  /**
   * Return the parsed list of allowed IPs from env. Empty list means
   * "allow all" (dev) — in that case we emit a one-time warning.
   */
  private getAllowedIps(): string[] {
    const raw = process.env.SMS_WEBHOOK_ALLOWED_IPS ?? '';
    return raw
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0);
  }

  /**
   * Decide whether the incoming request IP is allowed.
   * Returns true if the env var is unset/empty (dev) OR the IP matches.
   * Logs a one-time warning when the allow-list is missing.
   */
  private isIpAllowed(req: Request): boolean {
    const allowed = this.getAllowedIps();
    if (allowed.length === 0) {
      if (!this.loggedMissingAllowList) {
        this.logger.warn(
          '[SMS-Webhook] SMS_WEBHOOK_ALLOWED_IPS is empty — allowing all IPs. Set this in production.',
        );
        this.loggedMissingAllowList = true;
      }
      return true;
    }
    const reqIp = req.ip ?? '';
    return allowed.includes(reqIp);
  }

  /**
   * Record anomaly + return a 403 response. Returns false so caller short-circuits.
   */
  private async denyIp(req: Request, res: Response, method: 'GET' | 'POST'): Promise<void> {
    const reqIp = req.ip ?? 'unknown';
    this.logger.warn(`[SMS-Webhook] Blocked IP ${reqIp} — not in SMS_WEBHOOK_ALLOWED_IPS (${method})`);
    await this.anomaly.record({
      provider: 'sms',
      reason: 'other',
      ipAddress: reqIp,
      userAgent: req.headers['user-agent'] as string | undefined,
      meta: { method, note: 'ip_not_allowed' },
    });
    res.status(403).json({ ok: false, error: 'ไม่อนุญาตให้เข้าถึง' });
  }

  @Get('sms-webhook')
  @SkipCsrf()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async handleDeliveryReportGet(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!this.isIpAllowed(req)) {
      await this.denyIp(req, res, 'GET');
      return;
    }
    this.logger.log(`[SMS-Webhook] Delivery report received (GET)`);
    try {
      const result = await this.notificationsService.handleSmsDeliveryReport(query);
      res.status(200).json(result);
    } catch (err) {
      this.logger.error(`[SMS-Webhook] handler error: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { module: 'sms-webhook', method: 'GET' } });
      res.status(200).json({ ok: false });
    }
  }

  @Post('sms-webhook')
  @SkipCsrf()
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async handleDeliveryReportPost(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!this.isIpAllowed(req)) {
      await this.denyIp(req, res, 'POST');
      return;
    }
    this.logger.log(`[SMS-Webhook] Delivery report received (POST)`);
    try {
      const result = await this.notificationsService.handleSmsDeliveryReport(body);
      res.status(200).json(result);
    } catch (err) {
      this.logger.error(`[SMS-Webhook] handler error: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { module: 'sms-webhook', method: 'POST' } });
      res.status(200).json({ ok: false });
    }
  }
}
