import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Hourly cost check. If cumulative USD spend for the current Asia/Bangkok
 * day exceeds the configured budget (ANTHROPIC_DAILY_BUDGET_USD, default
 * $10), emit a Sentry warning with a per-service breakdown.
 *
 * We intentionally do NOT hard-stop AI calls here — that belongs at the
 * call site with idempotent checks. This cron is observability first;
 * stopping runaway usage is a separate project.
 */
@Injectable()
export class AiBudgetCron {
  private readonly logger = new Logger(AiBudgetCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Cron('10 * * * *', { timeZone: 'Asia/Bangkok' })
  async checkDailyBudget(): Promise<{ totalUsd: number; breached: boolean }> {
    try {
      const budget = Number(this.config.get<string>('ANTHROPIC_DAILY_BUDGET_USD') ?? '10');
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      const rows = await this.prisma.aiUsageLog.groupBy({
        by: ['service'],
        where: { createdAt: { gte: start } },
        _sum: { costUsd: true },
      });

      const byService: Record<string, number> = {};
      let totalUsd = 0;
      for (const row of rows) {
        const svcCost = Number(row._sum.costUsd ?? 0);
        byService[row.service] = svcCost;
        totalUsd += svcCost;
      }

      const breached = totalUsd > budget;
      const alertThreshold = budget * 0.8;

      if (breached) {
        this.logger.error(
          `AI daily budget breached: total $${totalUsd.toFixed(4)} > budget $${budget.toFixed(2)}`,
        );
        Sentry.captureMessage(
          `AI daily budget breached: $${totalUsd.toFixed(4)} > $${budget.toFixed(2)}`,
          {
            level: 'error',
            tags: { kind: 'cron-job', cron: 'ai-budget' },
            extra: { totalUsd, budget, byService },
          },
        );
      } else if (totalUsd >= alertThreshold) {
        this.logger.warn(
          `AI daily spend ${((totalUsd / budget) * 100).toFixed(0)}% of budget`,
        );
        Sentry.captureMessage(
          `AI daily spend at ${((totalUsd / budget) * 100).toFixed(0)}% of $${budget.toFixed(2)}`,
          {
            level: 'warning',
            tags: { kind: 'cron-job', cron: 'ai-budget' },
            extra: { totalUsd, budget, byService },
          },
        );
      }

      return { totalUsd, breached };
    } catch (err) {
      this.logger.error(`AI budget cron failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'ai-budget' } });
      return { totalUsd: 0, breached: false };
    }
  }
}
