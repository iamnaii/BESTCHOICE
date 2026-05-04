import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { InstallmentAccrual2ATemplate } from '../cpa-templates/installment-accrual-2a.template';

/**
 * Runs daily at 00:01 Asia/Bangkok.
 * Finds all InstallmentSchedule rows with dueDate = today and no accrualJournalEntryId,
 * then fires Template 2A for each.
 *
 * Idempotent: template skips installments already marked as accrued.
 * Per-installment failures are captured to Sentry and logged — the cron continues.
 */
@Injectable()
export class InstallmentAccrualCron {
  private readonly logger = new Logger(InstallmentAccrualCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly template: InstallmentAccrual2ATemplate,
  ) {}

  @Cron('1 0 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{ processed: number; failed: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const due = await this.prisma.installmentSchedule.findMany({
      where: {
        dueDate: { gte: today, lt: tomorrow },
        accrualJournalEntryId: null,
        deletedAt: null,
      },
    });

    this.logger.log(`Accrual cron: ${due.length} installment(s) due today`);

    let processed = 0;
    let failed = 0;

    for (const inst of due) {
      try {
        const result = await this.template.execute(inst.id);
        if (result !== null) processed++;
      } catch (e) {
        failed++;
        Sentry.captureException(e, {
          extra: { installmentScheduleId: inst.id, contractId: inst.contractId },
        });
        this.logger.error(
          `Accrual failed for installmentScheduleId=${inst.id}: ${(e as Error).message}`,
        );
      }
    }

    this.logger.log(`Accrual cron complete: processed=${processed} failed=${failed}`);
    return { processed, failed };
  }
}
