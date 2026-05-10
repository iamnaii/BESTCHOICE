import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { InstallmentAccrual2ATemplate } from '../cpa-templates/installment-accrual-2a.template';
import { validatePeriodOpen } from '../../../utils/period-lock.util';

// Per-tick cap to avoid one tick processing tens of thousands of legacy
// records and blowing the Sentry/log budget. Anything beyond this rolls
// to the next tick (FIFO by dueDate). Override via ACCRUAL_BACKFILL_CAP
// env if migrating large legacy data — set ≥ legacy size to backfill in
// one tick, then revert to default.
const DEFAULT_BACKFILL_CAP = 1000;
const BACKFILL_CAP = (() => {
  const raw = process.env.ACCRUAL_BACKFILL_CAP;
  if (!raw) return DEFAULT_BACKFILL_CAP;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BACKFILL_CAP;
})();

/**
 * Runs daily at 00:01 Asia/Bangkok.
 * Finds all InstallmentSchedule rows with dueDate <= today and no accrualJournalEntryId,
 * then fires Template 2A for each.
 *
 * Backfill behavior: catches up any past-due installment that was missed
 * (cron skipped a day, contract created with backdated dueDate via legacy import,
 * or test data inserted manually). The 2A template stamps `postedAt = inst.dueDate`
 * so the JE is recorded in the correct accounting period regardless of when
 * the cron actually runs.
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
  async tick(): Promise<{ processed: number; failed: number; skippedClosedPeriod: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // CPA Manual Termination Policy: skip contracts that have been terminated
    // via 60D dispatch (status='TERMINATED'). Once หนังสือบอกเลิก is dispatched,
    // 2A accrual must stop — contract is closed legally (ปพพ.386).
    // Refs: docs/superpowers/specs/2026-05-09-manual-termination-workflow-design.md
    //
    // Query catches everything dueDate < tomorrow (today + past) so any
    // installment missed by a previous cron run gets accrued on the next tick.
    // Bounded by BACKFILL_CAP to keep one tick predictable; remainder rolls
    // forward (oldest-first via orderBy dueDate asc).
    const due = await this.prisma.installmentSchedule.findMany({
      where: {
        dueDate: { lt: tomorrow },
        accrualJournalEntryId: null,
        deletedAt: null,
        contract: {
          status: { notIn: ['TERMINATED', 'CLOSED_BAD_DEBT', 'COMPLETED', 'EARLY_PAYOFF', 'EXCHANGED', 'DEFECT_EXCHANGED'] },
          deletedAt: null,
        },
      },
      orderBy: { dueDate: 'asc' },
      take: BACKFILL_CAP,
      include: {
        contract: { select: { id: true, contractNumber: true, branch: { select: { companyId: true } } } },
      },
    });

    this.logger.log(`Accrual cron: ${due.length} installment(s) due (incl. backfill, cap=${BACKFILL_CAP})`);

    let processed = 0;
    let failed = 0;
    let skippedClosedPeriod = 0;

    for (const inst of due) {
      // Closed-period guard: never silently post 2A into a CLOSED/SYNCED period.
      // Skip + Sentry warn so accountant can re-open the period or post a manual
      // catch-up adjustment. Without this, backfill could violate ปพพ.386 / TFRS 15
      // by mutating an already-locked accounting period.
      const companyId = inst.contract.branch?.companyId ?? undefined;
      try {
        await validatePeriodOpen(this.prisma, inst.dueDate, companyId);
      } catch (e) {
        skippedClosedPeriod++;
        Sentry.captureMessage(
          `2A accrual skipped — closed period for installment ${inst.id} (contract ${inst.contract.contractNumber}, dueDate ${inst.dueDate.toISOString()})`,
          {
            level: 'warning',
            extra: {
              installmentScheduleId: inst.id,
              contractId: inst.contract.id,
              dueDate: inst.dueDate.toISOString(),
              reason: (e as Error).message,
            },
          },
        );
        this.logger.warn(
          `Accrual skipped (closed period) installmentScheduleId=${inst.id}: ${(e as Error).message}`,
        );
        continue;
      }

      try {
        const result = await this.template.execute(inst.id);
        if (result !== null) processed++;
      } catch (e) {
        failed++;
        Sentry.captureException(e, {
          extra: { installmentScheduleId: inst.id, contractId: inst.contract.id },
        });
        this.logger.error(
          `Accrual failed for installmentScheduleId=${inst.id}: ${(e as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Accrual cron complete: processed=${processed} failed=${failed} skippedClosedPeriod=${skippedClosedPeriod}`,
    );

    // Escalate to error-level when any installment was skipped due to closed
    // period — accountant must take action (re-open period or post manual
    // adjustment). Warning-level Sentry events are easy to miss; one
    // consolidated error-level message + AuditLog row is the actionable
    // signal. Done after the loop so we report once per tick, not per row.
    if (skippedClosedPeriod > 0) {
      Sentry.captureMessage(
        `2A accrual cron stalled — ${skippedClosedPeriod} installment(s) blocked by closed accounting period`,
        {
          level: 'error',
          tags: { cron: 'installment-accrual', signal: 'BACKFILL_STALLED' },
          extra: { processed, failed, skippedClosedPeriod, totalDue: due.length },
        },
      );
      try {
        const systemUser = await this.prisma.user.findFirst({
          where: { isSystemUser: true },
          select: { id: true },
        });
        if (systemUser) {
          await this.prisma.auditLog.create({
            data: {
              action: 'BACKFILL_STALLED',
              entity: 'installment_accrual_cron',
              entityId: 'system',
              userId: systemUser.id,
              newValue: {
                skippedClosedPeriod,
                processed,
                failed,
                totalDue: due.length,
                tickAt: new Date().toISOString(),
              },
            },
          });
        }
      } catch (e) {
        this.logger.error(`Failed to write BACKFILL_STALLED audit log: ${(e as Error).message}`);
      }
    }

    return { processed, failed, skippedClosedPeriod };
  }
}
