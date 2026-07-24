import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { BadDebtService } from './bad-debt.service';

/**
 * Wave 5 Task 5 — automated daily Bad Debt provision cron.
 *
 * Excel v3 "Daily Cron" (spec 2026-07-23 §4 1c): provisions calculated
 * every day at 00:30 BKK (after 2A accrual cron 00:01) as self-healing
 * delta vs GL 11-2102 (allowance for doubtful accounts). Each run is
 * idempotent per runDate at the JE template level (computes aging buckets
 * from T-0 accrued installments, provisions fresh JE with idempotency key).
 *
 * Why a standalone daily cron (not integrated with monthly-close.service):
 *   - monthly-close is a manual state machine (OPEN→REVIEW→CLOSED→SYNCED)
 *     triggered per-company by FINANCE_MANAGER. Auto-firing provision
 *     independently gives GL visibility day-to-day without blocking on close.
 *   - calculateProvisions() always operates on "now" (oldest unpaid
 *     dueDate as of run time). Daily runs capture aging drift on a rolling basis.
 *   - System-wide single run, not per-company. Cleaner ops contract.
 *
 * Failure mode: any error → Sentry + log, but cron does NOT throw.
 * Losing one day's auto-run is recoverable via manual UI trigger next day.
 */
@Injectable()
export class BadDebtProvisionCron {
  private readonly logger = new Logger(BadDebtProvisionCron.name);

  constructor(
    private readonly badDebt: BadDebtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Every day at 00:30 BKK — calculate provision for current month */
  @Cron('30 0 * * *', { timeZone: 'Asia/Bangkok' })
  async run(): Promise<{ created: number; totalProvision: number; period: string } | null> {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    this.logger.log(`[BadDebtProvisionCron] start period=${period}`);

    try {
      // Resolve SYSTEM user once — calculateProvisions wants a calculatedById.
      // If the seed hasn't run we abort with a clear Sentry message rather
      // than crashing with an FK error mid-batch.
      const systemUser = await this.prisma.user.findFirst({
        where: { isSystemUser: true },
        select: { id: true },
      });
      if (!systemUser) {
        const msg =
          '[BadDebtProvisionCron] SYSTEM user not found — seed collections-foundation must run first';
        this.logger.error(msg);
        Sentry.captureMessage(msg, {
          level: 'error',
          tags: { kind: 'cron-job', cron: 'bad-debt-provision', step: 'system-user-missing' },
        });
        return null;
      }

      const result = await this.badDebt.calculateProvisions(systemUser.id);

      this.logger.log(
        `[BadDebtProvisionCron] period=${period} created=${result.created} ` +
          `totalProvision=${result.totalProvision.toLocaleString()}`,
      );
      Sentry.captureMessage(
        `BadDebtProvisionCron period=${period} created=${result.created}`,
        {
          level: 'info',
          tags: { kind: 'cron-job', cron: 'bad-debt-provision' },
          extra: {
            period,
            created: result.created,
            totalProvision: result.totalProvision,
            byBucket: result.byBucket,
          },
        },
      );

      return { created: result.created, totalProvision: result.totalProvision, period };
    } catch (err) {
      this.logger.error(
        `[BadDebtProvisionCron] failed period=${period}: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'bad-debt-provision' },
        extra: { period },
      });
      return null;
    }
  }
}
