import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { DepreciationTemplate } from '../cpa-templates/depreciation.template';

/**
 * Phase A.5c — Monthly depreciation cron.
 *
 * Runs daily on days 28–31; guards that it only executes on the actual last day of the month
 * (i.e. tomorrow is a different month). This avoids the complexity of computing "last day"
 * ahead of time and handles all month lengths correctly (28/29/30/31).
 *
 * Schedule: '0 1 28-31 * *' — 01:00 Asia/Bangkok on days 28, 29, 30, 31.
 */
@Injectable()
export class DepreciationCron {
  private readonly logger = new Logger(DepreciationCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly template: DepreciationTemplate,
  ) {}

  @Cron('0 1 28-31 * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{ processed: number; skipped: number; failed: number }> {
    // Guard: only run on the actual last day of the month — BKK time.
    // The @Cron schedule fires at 01:00 BKK = 18:00 UTC the previous day.
    // Using `new Date().getMonth()` reads the UTC date, which made the
    // guard always return true (next-day-still-same-month) → cron never
    // posted any JE. Compute "today BKK" + "tomorrow BKK" from Intl parts.
    const bkkParts = (d: Date) =>
      d.toLocaleString('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    const now = new Date();
    const [todayY, todayM] = bkkParts(now)
      .split('-')
      .map((s) => parseInt(s, 10));
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const [tmrY, tmrM] = bkkParts(tomorrow)
      .split('-')
      .map((s) => parseInt(s, 10));
    const isLastDay = todayY !== tmrY || todayM !== tmrM;
    if (!isLastDay) {
      // Not the last day — exit silently
      return { processed: 0, skipped: 0, failed: 0 };
    }

    const period = `${todayY}-${todayM.toString().padStart(2, '0')}`;
    this.logger.log(`[Phase1] DepreciationCron: running for period ${period}`);

    const assets = await this.prisma.fixedAsset.findMany({
      where: { status: 'POSTED', deletedAt: null },
      select: { id: true, assetCode: true },
    });

    this.logger.log(`[Phase1] DepreciationCron: ${assets.length} posted asset(s) to process`);

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const asset of assets) {
      try {
        const result = await this.template.execute({ assetId: asset.id, period });
        if (result !== null) {
          processed++;
        } else {
          skipped++;
        }
      } catch (e) {
        failed++;
        Sentry.captureException(e, {
          extra: { assetId: asset.id, assetCode: asset.assetCode, period },
          tags: { kind: 'cron-job', cron: 'monthly-depreciation-a5c' },
        });
        this.logger.error(
          `[Phase1] DepreciationCron: failed for asset ${asset.assetCode}: ${(e as Error).message}`,
        );
      }
    }

    this.logger.log(
      `[Phase1] DepreciationCron: period=${period} processed=${processed} skipped=${skipped} failed=${failed}`,
    );

    return { processed, skipped, failed };
  }
}
