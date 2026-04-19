import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { INTEGRATIONS } from './integration-registry';

/**
 * Weekly check for stale sensitive credentials (T6-C9).
 *
 * Loops through all integrations in the registry; for each field marked
 * `sensitive: true`, looks up the SystemConfig row at
 * `integration.<integrationKey>.<fieldKey>` and emits a Sentry warning if
 * `updatedAt` is older than STALE_THRESHOLD_DAYS (default 90).
 *
 * The alarm is informational: it doesn't block the integration. It is the
 * trigger for OWNER to run the rotation runbook — see
 * `docs/guides/PEAK-CREDENTIALS-RUNBOOK.md`.
 *
 * Missing credentials (no SystemConfig row at all) are treated as "not
 * configured" and skipped — we only flag credentials that were configured
 * once and then left to rot.
 */
@Injectable()
export class CredentialRotationCron {
  private readonly logger = new Logger(CredentialRotationCron.name);

  private readonly staleThresholdDays: number;

  constructor(private readonly prisma: PrismaService) {
    const envValue = process.env.INTEGRATION_ROTATION_THRESHOLD_DAYS;
    const parsed = envValue ? parseInt(envValue, 10) : NaN;
    this.staleThresholdDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
  }

  /** Every Monday 06:00 Asia/Bangkok. */
  @Cron('0 6 * * 1', { timeZone: 'Asia/Bangkok' })
  async checkStale(): Promise<{ stale: number; ok: number; skipped: number }> {
    try {
      const stale: Array<{ integration: string; field: string; ageDays: number }> = [];
      let ok = 0;
      let skipped = 0;

      const now = Date.now();
      const thresholdMs = this.staleThresholdDays * 24 * 60 * 60 * 1000;

      for (const def of INTEGRATIONS) {
        for (const field of def.fields) {
          if (!field.sensitive) continue;

          const row = await this.prisma.systemConfig.findFirst({
            where: {
              key: `integration.${def.key}.${field.key}`,
              deletedAt: null,
            },
            select: { updatedAt: true, value: true },
          });

          if (!row || !row.value) {
            skipped++;
            continue;
          }

          const ageMs = now - row.updatedAt.getTime();
          if (ageMs > thresholdMs) {
            stale.push({
              integration: def.key,
              field: field.key,
              ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
            });
          } else {
            ok++;
          }
        }
      }

      if (stale.length > 0) {
        const sample = stale.slice(0, 10).map((s) => `${s.integration}.${s.field}=${s.ageDays}d`);
        this.logger.warn(
          `Stale credentials (>${this.staleThresholdDays}d): ${stale.length} — ${sample.join(', ')}`,
        );
        Sentry.captureMessage(
          `Integration credentials stale: ${stale.length} field(s) > ${this.staleThresholdDays} days`,
          {
            level: 'warning',
            tags: { kind: 'cron-job', cron: 'credential-rotation' },
            extra: { stale, thresholdDays: this.staleThresholdDays },
          },
        );
      } else {
        this.logger.log(
          `Credential rotation check: ${ok} fresh, ${skipped} not configured, 0 stale`,
        );
      }

      return { stale: stale.length, ok, skipped };
    } catch (err) {
      this.logger.error(
        `Credential rotation cron failed: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'credential-rotation' },
      });
      return { stale: 0, ok: 0, skipped: 0 };
    }
  }
}
