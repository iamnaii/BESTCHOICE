import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { BadDebtService } from './bad-debt.service';

/**
 * Wave 4 Task 1 — automated monthly Bad Debt provision cron.
 *
 * ก่อนหน้านี้ provision ต้องกด manual ผ่าน UI ทุกเดือน ซึ่งเสี่ยง
 * (ลืม / ทำตอนกลางเดือน / ทำหลายรอบ). Cron นี้รันอัตโนมัติทุกวันที่ 1
 * ของเดือนเวลา 00:30 BKK สำหรับเดือนก่อนหน้า เพื่อให้ provisions
 * อยู่ในงบของเดือนที่ปิดไปแล้ว (TFRS 9 W-1/W-2 audit fix).
 *
 * Why a standalone cron (not integrated with monthly-close.service):
 *   - monthly-close is a manual state machine (OPEN→REVIEW→CLOSED→SYNCED)
 *     triggered per-company by FINANCE_MANAGER. Auto-firing provision on
 *     review-start would be a side-effect surprise.
 *   - calculateProvisions() always operates on "now" (oldest unpaid
 *     dueDate as of run time) — there's no period parameter to thread.
 *     A standalone cron run on day 1 of each month captures the prior
 *     month's tail-end aging cleanly.
 *   - System-wide single run, not per-company. Cleaner ops contract.
 *
 * Failure mode: any error → Sentry + log, but cron does NOT throw.
 * Losing one month's auto-run is recoverable via manual UI trigger.
 */
@Injectable()
export class BadDebtProvisionCron {
  private readonly logger = new Logger(BadDebtProvisionCron.name);

  constructor(
    private readonly badDebt: BadDebtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Day 1 of every month at 00:30 BKK — calculate provision for prior month */
  @Cron('30 0 1 * *', { timeZone: 'Asia/Bangkok' })
  async run(): Promise<{ created: number; totalProvision: number; period: string } | null> {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const period = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;

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
