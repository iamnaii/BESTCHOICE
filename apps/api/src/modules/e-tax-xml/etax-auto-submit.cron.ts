import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { ETaxSubmissionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ETaxXmlService } from './e-tax-xml.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

/**
 * Hourly auto-submit cron — runs only when ETAX_SUBMIT_MODE='enabled'.
 *
 * Behavior:
 *   1. Read submit mode. If disabled → exit immediately (no DB read).
 *   2. Find PENDING submissions for payments older than 24h (gives ops a
 *      chance to manually correct before the bot sends).
 *   3. For each: sign → submit → record outcome. Errors per row are
 *      caught individually so one bad cert won't block siblings.
 *
 * C10 — Audit logs are written under the SYSTEM user (User.isSystemUser=true),
 * resolved at runtime via PrismaService — same pattern as
 * promise-resolution.cron and broken-promise.cron. The seed-collections
 * migration must have run first (the SYSTEM user is created there).
 */
@Injectable()
export class ETaxAutoSubmitCron {
  private readonly logger = new Logger(ETaxAutoSubmitCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: ETaxXmlService,
    private readonly integrationConfig: IntegrationConfigService,
  ) {}

  /**
   * C10 — Resolve the SYSTEM user UUID. Mirrors
   * PromiseResolutionCron.getSystemUserId() — single source of truth
   * for cron-actor identity. Returns null + alerts Sentry when the
   * seed hasn't run; caller decides whether that's fatal.
   */
  private async getSystemUserId(): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!user) {
      this.logger.error(
        'SYSTEM user not found (User.isSystemUser=true) — seed collections-foundation must run first',
      );
      Sentry.captureMessage('etax.cron.no_system_user', { level: 'error' });
      return null;
    }
    return user.id;
  }

  /** Cron: hourly at minute 15 (offset from common :00/:30 crons) BKK time */
  @Cron('15 * * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<void> {
    try {
      const mode = await this.integrationConfig.getValue('e-tax', 'submitMode');
      if (mode !== 'enabled') {
        // Quiet — this is the default; logging every hour would be spam.
        return;
      }

      const userId = await this.getSystemUserId();
      if (!userId) return; // already logged + Sentry'd

      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const pending = await this.prisma.eTaxSubmission.findMany({
        where: {
          status: ETaxSubmissionStatus.PENDING,
          deletedAt: null,
          createdAt: { lt: cutoff },
        },
        select: { id: true },
        take: 50, // cap per tick
      });

      this.logger.log(`auto-submit tick: ${pending.length} candidates`);

      for (const row of pending) {
        try {
          const signed = await this.service.signSubmission(row.id, userId);
          if (signed.status === ETaxSubmissionStatus.SIGNED) {
            await this.service.submitToRd(row.id, userId);
          }
        } catch (err) {
          this.logger.error(
            `auto-submit failed for ${row.id}: ${(err as Error).message}`,
          );
          Sentry.captureException(err, {
            tags: {
              kind: 'cron-job',
              cron: 'etax-auto-submit',
              submissionId: row.id,
            },
          });
        }
      }
    } catch (err) {
      this.logger.error('etax-auto-submit cron failed', err);
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'etax-auto-submit' },
      });
    }
  }
}
