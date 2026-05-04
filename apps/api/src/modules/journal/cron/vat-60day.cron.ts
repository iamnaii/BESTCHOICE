import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { Vat60dayMandatoryTemplate } from '../cpa-templates/vat-60day-mandatory.template';

/**
 * Runs daily at 02:00 Asia/Bangkok.
 *
 * Finds all InstallmentSchedule rows where:
 *   - dueDate <= (today - 60 days)
 *   - vat60dayJournalEntryId is null (not yet processed)
 *   - No PAID Payment record for this installment
 *
 * For each candidate, fires Vat60dayMandatoryTemplate.execute().
 *
 * Idempotent: mandatory template is a no-op if vat60dayJournalEntryId is set.
 * Per-installment failures are captured to Sentry — cron continues on error.
 */
@Injectable()
export class Vat60dayCron {
  private readonly logger = new Logger(Vat60dayCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mandatory: Vat60dayMandatoryTemplate,
  ) {}

  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{ processed: number; failed: number }> {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const candidates = await this.prisma.installmentSchedule.findMany({
      where: {
        dueDate: { lte: cutoff },
        vat60dayJournalEntryId: null,
        deletedAt: null,
      },
    });

    this.logger.log(`VAT 60-day cron: ${candidates.length} candidate(s) found`);

    let processed = 0;
    let failed = 0;

    for (const inst of candidates) {
      // Skip if there is already a PAID payment for this installment
      const paidCount = await this.prisma.payment.count({
        where: {
          contractId: inst.contractId,
          installmentNo: inst.installmentNo,
          status: 'PAID',
          deletedAt: null,
        },
      });

      if (paidCount > 0) continue;

      try {
        const result = await this.mandatory.execute(inst.id);
        if (result !== null) processed++;
      } catch (e) {
        failed++;
        Sentry.captureException(e, {
          extra: { installmentScheduleId: inst.id, contractId: inst.contractId },
        });
        this.logger.error(
          `VAT 60-day mandatory failed for installmentScheduleId=${inst.id}: ${(e as Error).message}`,
        );
      }
    }

    this.logger.log(`VAT 60-day cron complete: processed=${processed} failed=${failed}`);
    return { processed, failed };
  }
}
