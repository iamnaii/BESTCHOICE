import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { Vat60dayMandatoryTemplate } from '../cpa-templates/vat-60day-mandatory.template';

/**
 * Runs daily at 02:00 Asia/Bangkok.
 *
 * Finds all InstallmentSchedule rows where:
 *   - dueDate < (today - 60 days) — strictly more than 60 days overdue per ม.82/3
 *   - vat60dayJournalEntryId is null (not yet processed)
 *   - No PAID Payment record (status='PAID' = fully settled per Payment lifecycle)
 *
 * For each candidate, fires Vat60dayMandatoryTemplate.execute().
 *
 * Idempotent: mandatory template is a no-op if vat60dayJournalEntryId is set.
 * Per-installment failures are captured to Sentry — cron continues on error.
 *
 * N+1 elimination: PAID-payment lookup is one batched query per cron run,
 * not one query per candidate.
 */
@Injectable()
export class Vat60dayCron {
  private readonly logger = new Logger(Vat60dayCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mandatory: Vat60dayMandatoryTemplate,
  ) {}

  /**
   * Returns the 60-day cutoff anchored to Asia/Bangkok midnight.
   *
   * Uses the Bangkok calendar date so the cutoff is stable regardless of
   * the host process timezone (Cloud Run defaults to UTC). Thailand does
   * not observe DST, so no DST adjustment is needed — the +07:00 offset
   * is constant year-round.
   */
  private getCutoffBangkok(): Date {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const bkkDate = formatter.format(new Date()); // YYYY-MM-DD in Bangkok
    const cutoff = new Date(`${bkkDate}T00:00:00+07:00`);
    cutoff.setDate(cutoff.getDate() - 60);
    return cutoff;
  }

  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{ processed: number; failed: number }> {
    const cutoff = this.getCutoffBangkok();

    const candidates = await this.prisma.installmentSchedule.findMany({
      where: {
        // strict less-than: ม.82/3 = "เกิน 60 วัน" (strictly more than 60 days)
        dueDate: { lt: cutoff },
        vat60dayJournalEntryId: null,
        deletedAt: null,
      },
      select: { id: true, contractId: true, installmentNo: true },
    });

    this.logger.log(`VAT 60-day cron: ${candidates.length} candidate(s) found`);

    if (candidates.length === 0) {
      this.logger.log('VAT 60-day cron complete: processed=0 failed=0');
      return { processed: 0, failed: 0 };
    }

    // Batch fetch all PAID (= fully settled) payments for these
    // (contractId, installmentNo) tuples in a single query. Avoids N+1.
    const contractIds = [...new Set(candidates.map((c) => c.contractId))];
    const installmentNos = [...new Set(candidates.map((c) => c.installmentNo))];
    const paidPayments = await this.prisma.payment.findMany({
      where: {
        contractId: { in: contractIds },
        installmentNo: { in: installmentNos },
        status: 'PAID',
        deletedAt: null,
      },
      select: { contractId: true, installmentNo: true },
    });
    const paidKey = (contractId: string, installmentNo: number) =>
      `${contractId}:${installmentNo}`;
    const paidSet = new Set(
      paidPayments.map((p) => paidKey(p.contractId, p.installmentNo)),
    );

    let processed = 0;
    let failed = 0;

    for (const inst of candidates) {
      // Skip fully-settled installments (status='PAID' = customer paid full amountDue
      // per the Payment lifecycle: PENDING → PARTIALLY_PAID → PAID)
      if (paidSet.has(paidKey(inst.contractId, inst.installmentNo))) continue;

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
