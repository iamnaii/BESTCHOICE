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
 *
 * T6-C17: Rate limiting
 *   - Flood cap: if the same (provider, reason) already wrote ≥ FLOOD_LIMIT
 *     rows in the last hour, new records are dropped. A single aggregated
 *     Sentry info message is emitted per (provider, reason) flood window to
 *     keep the alert channel quiet when an attacker is pounding us.
 *   - Spike warning: independently, if a provider crossed SPIKE_LIMIT
 *     anomalies in the last 5 minutes, emit a Sentry warning so on-call sees
 *     it fast (in addition to the hourly cron roll-up).
 *
 * Both thresholds share an in-memory dedupe map so Sentry isn't spammed for
 * every request during a flood. The 10-minute cooldown is reset in-memory
 * only — acceptable because the persistent counters in the DB still drive
 * the hourly cron.
 */
@Injectable()
export class WebhookAnomalyService {
  private readonly logger = new Logger(WebhookAnomalyService.name);

  /** Skip new DB inserts once this many rows for (provider,reason) exist in last hour. */
  static readonly FLOOD_LIMIT = 100;
  /** Raise a Sentry warning if a provider crossed this in the last 5 min. */
  static readonly SPIKE_LIMIT = 5;
  /** Sentry dedupe window — one aggregate message per key per window. */
  static readonly SENTRY_COOLDOWN_MS = 10 * 60 * 1000;

  /** Keyed by `${provider}|${reason}|flood` or `${provider}|spike`. */
  private readonly sentryDedupe = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AnomalyRecord): Promise<void> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

      const [sameReasonHourly, providerSpike] = await Promise.all([
        this.prisma.webhookAnomaly.count({
          where: {
            provider: entry.provider,
            reason: entry.reason,
            createdAt: { gte: oneHourAgo },
          },
        }),
        this.prisma.webhookAnomaly.count({
          where: {
            provider: entry.provider,
            createdAt: { gte: fiveMinAgo },
          },
        }),
      ]);

      // Flood cap — drop this insert (DB is already full of the same signal)
      if (sameReasonHourly >= WebhookAnomalyService.FLOOD_LIMIT) {
        this.maybeSentry(`${entry.provider}|${entry.reason}|flood`, () => {
          Sentry.captureMessage('Webhook anomaly flood — inserts suppressed', {
            level: 'info',
            tags: {
              module: 'webhook-security',
              action: 'anomaly_flood',
              provider: entry.provider,
              reason: entry.reason,
            },
            extra: {
              provider: entry.provider,
              reason: entry.reason,
              hourlyCount: sameReasonHourly,
              floodLimit: WebhookAnomalyService.FLOOD_LIMIT,
            },
          });
        });
        return;
      }

      await this.prisma.webhookAnomaly.create({
        data: {
          provider: entry.provider,
          reason: entry.reason,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ? entry.userAgent.slice(0, 500) : null,
          meta: (entry.meta as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });

      // Spike warning — only crosses the line once per cooldown per provider.
      // providerSpike is the count *before* this insert; after the insert it
      // will be providerSpike + 1, which is what matters for the threshold.
      if (providerSpike + 1 >= WebhookAnomalyService.SPIKE_LIMIT) {
        this.maybeSentry(`${entry.provider}|spike`, () => {
          Sentry.captureMessage('Webhook anomaly spike (5-min)', {
            level: 'warning',
            tags: {
              module: 'webhook-security',
              action: 'anomaly_spike',
              provider: entry.provider,
            },
            extra: {
              provider: entry.provider,
              recentCount: providerSpike + 1,
              spikeLimit: WebhookAnomalyService.SPIKE_LIMIT,
              lastReason: entry.reason,
            },
          });
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to persist webhook anomaly for ${entry.provider}: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { module: 'webhook-security', action: 'record_anomaly' },
      });
    }
  }

  private maybeSentry(key: string, send: () => void): void {
    const now = Date.now();
    const last = this.sentryDedupe.get(key);
    if (last && now - last < WebhookAnomalyService.SENTRY_COOLDOWN_MS) return;
    this.sentryDedupe.set(key, now);
    send();

    // opportunistic cleanup of stale entries
    if (this.sentryDedupe.size > 100) {
      for (const [k, v] of this.sentryDedupe) {
        if (now - v > WebhookAnomalyService.SENTRY_COOLDOWN_MS) {
          this.sentryDedupe.delete(k);
        }
      }
    }
  }
}
