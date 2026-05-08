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
    // Guard: only run on the actual last day of the month
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getMonth() === now.getMonth()) {
      // Not the last day — exit silently
      return { processed: 0, skipped: 0, failed: 0 };
    }

    const period = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    this.logger.log(`[A.5c] DepreciationCron: running for period ${period}`);

    const assets = await this.prisma.fixedAsset.findMany({
      where: { status: 'POSTED', deletedAt: null },
      select: { id: true, assetCode: true },
    });

    this.logger.log(`[A.5c] DepreciationCron: ${assets.length} posted asset(s) to process`);

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
          `[A.5c] DepreciationCron: failed for asset ${asset.assetCode}: ${(e as Error).message}`,
        );
      }
    }

    this.logger.log(
      `[A.5c] DepreciationCron: period=${period} processed=${processed} skipped=${skipped} failed=${failed}`,
    );

    return { processed, skipped, failed };
  }
}
