import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Hourly observation of webhook anomalies. Alerts Sentry if any single
 * provider crosses the spike threshold — more than that in one hour usually
 * means a credential-stuffing probe or a mis-rotated secret, and we want
 * someone to look.
 */
@Injectable()
export class WebhookAnomalyCron {
  private readonly logger = new Logger(WebhookAnomalyCron.name);
  static readonly SPIKE_THRESHOLD = 10;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('5 * * * *', { timeZone: 'Asia/Bangkok' })
  async detectSpikes(): Promise<{ total: number; spikes: Array<{ provider: string; count: number }> }> {
    try {
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const rows = await this.prisma.webhookAnomaly.groupBy({
        by: ['provider', 'reason'],
        where: { createdAt: { gte: since } },
        _count: true,
      });

      const byProvider = new Map<string, number>();
      for (const row of rows) {
        byProvider.set(row.provider, (byProvider.get(row.provider) ?? 0) + row._count);
      }

      const total = Array.from(byProvider.values()).reduce((a, b) => a + b, 0);
      const spikes = Array.from(byProvider.entries())
        .filter(([, count]) => count >= WebhookAnomalyCron.SPIKE_THRESHOLD)
        .map(([provider, count]) => ({ provider, count }));

      if (spikes.length > 0) {
        this.logger.warn(
          `Webhook anomaly spike(s): ${spikes.map((s) => `${s.provider}=${s.count}`).join(', ')}`,
        );
        Sentry.captureMessage(
          `Webhook anomaly spike in last hour: ${spikes.map((s) => `${s.provider}(${s.count})`).join(', ')}`,
          {
            level: 'warning',
            tags: { kind: 'cron-job', cron: 'webhook-anomaly' },
            extra: { spikes, totalAnomalies: total },
          },
        );
      }

      return { total, spikes };
    } catch (err) {
      this.logger.error(`Webhook anomaly cron failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'webhook-anomaly' } });
      return { total: 0, spikes: [] };
    }
  }
}
