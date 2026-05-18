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
 * SYSTEM user (env `ETAX_CRON_USER_ID`) is used as the actor for audit
 * logs — must be a real User row created by the seed/migration script.
 * If not configured, falls back to silently logging and skips audit
 * writes (still preserves the submission state).
 */
@Injectable()
export class ETaxAutoSubmitCron {
  private readonly logger = new Logger(ETaxAutoSubmitCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: ETaxXmlService,
    private readonly integrationConfig: IntegrationConfigService,
  ) {}

  /** Cron: hourly at minute 15 (offset from common :00/:30 crons) BKK time */
  @Cron('15 * * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<void> {
    try {
      const mode = await this.integrationConfig.getValue('e-tax', 'submitMode');
      if (mode !== 'enabled') {
        // Quiet — this is the default; logging every hour would be spam.
        return;
      }

      const userId = process.env.ETAX_CRON_USER_ID ?? '';
      if (!userId) {
        this.logger.warn(
          'ETAX_CRON_USER_ID not set — skipping auto-submit (cannot audit-log)',
        );
        Sentry.captureMessage('etax.cron.no_user_id', { level: 'warning' });
        return;
      }

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
