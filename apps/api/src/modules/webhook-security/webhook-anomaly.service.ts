import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

export type WebhookProvider =
  | 'line-finance'
  | 'line-shop'
  | 'line-staff'
  | 'paysolutions'
  | 'sms'
  | 'facebook';

export type AnomalyReason =
  | 'invalid_signature'
  | 'missing_signature'
  | 'missing_secret'
  | 'merchant_mismatch'
  | 'replay_suspicion'
  | 'other';

export interface AnomalyRecord {
  provider: WebhookProvider;
  reason: AnomalyReason;
  ipAddress?: string;
  userAgent?: string;
  meta?: Record<string, unknown>;
}

/**
 * Centralized observability for webhook signature anomalies.
 *
 * Rather than building per-provider logging paths, every webhook that verifies
 * its source funnels its rejections through this service. The hourly cron
 * (WebhookAnomalyCron) then looks for spikes — a sustained stream of invalid
 * signatures usually means either a bad secret rotation or a probing attacker.
 *
 * Writes are fire-and-forget: anomaly logging must never block webhook
 * processing, and failures to log are noted in-process only.
 */
@Injectable()
export class WebhookAnomalyService {
  private readonly logger = new Logger(WebhookAnomalyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AnomalyRecord): Promise<void> {
    try {
      await this.prisma.webhookAnomaly.create({
        data: {
          provider: entry.provider,
          reason: entry.reason,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ? entry.userAgent.slice(0, 500) : null,
          meta: (entry.meta as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist webhook anomaly for ${entry.provider}: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { module: 'webhook-security', action: 'record_anomaly' },
      });
    }
  }
}
