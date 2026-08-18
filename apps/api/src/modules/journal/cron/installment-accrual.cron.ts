import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { InstallmentAccrual2ATemplate } from '../cpa-templates/installment-accrual-2a.template';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { alarmResidualParkOnCompletion } from '../../payments/services/payment-helpers';

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

  /**
   * Upper bound for "due as of today" anchored to Asia/Bangkok midnight.
   *
   * The cron fires at 00:01 Asia/Bangkok but `new Date()` is host-local (Cloud Run
   * defaults to UTC), so `setHours(0,0,0,0)` previously produced UTC midnight and shifted
   * the `dueDate < tomorrow` window by +7h — installments due on the Bangkok calendar day
   * were accrued a day late/early on the boundary. Thailand has no DST so +07:00 is constant.
   */
  private getBkkTomorrowMidnight(): Date {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const bkkDate = formatter.format(new Date()); // today's YYYY-MM-DD in Bangkok
    const tomorrow = new Date(`${bkkDate}T00:00:00+07:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }

  @Cron('1 0 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{ processed: number; failed: number; skippedClosedPeriod: number }> {
    const tomorrow = this.getBkkTomorrowMidnight();

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
        contract: {
          select: {
            id: true,
            contractNumber: true,
            // R-5: needed to spot the LAST installment + its residual park money.
            totalMonths: true,
            rescheduleAdvanceBalance: true,
            branch: { select: { companyId: true } },
          },
        },
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

        // R-5 (re-review 2026-08-18): when the LAST installment is settled by the
        // 2A park-consume JE, no orchestrator ever runs for this contract, so the
        // residual-park alarm wired into `checkContractCompletion` never fires —
        // and that is precisely the scenario it was written for (multi-reschedule
        // contracts park more than one installment's worth, and 2A caps the relief
        // at one installment, so the remainder is real customer money nobody would
        // otherwise notice). Gated on the last installment so ordinary rows pay
        // nothing for this.
        //
        // Deliberately alarm-only: flipping the contract to COMPLETED from a cron
        // would also release product ownership and re-tier call recordings, which
        // is a lifecycle change nobody asked for here. NOTE (pre-existing, wider
        // than park): an installment fully settled by EITHER advance bucket at
        // accrual leaves the contract un-flipped — that gap predates this feature
        // and affects generic `advanceBalance` too. Tracked as a follow-up.
        if (result !== null && inst.installmentNo === inst.contract.totalMonths) {
          try {
            const residual = new Prisma.Decimal(inst.contract.rescheduleAdvanceBalance ?? 0);
            if (residual.gt(0)) {
              const unpaid = await this.prisma.payment.count({
                where: { contractId: inst.contract.id, status: { not: 'PAID' }, deletedAt: null },
              });
              if (unpaid === 0) {
                // Re-read the bucket: the accrual above may have just consumed part of it.
                const fresh = await this.prisma.contract.findUnique({
                  where: { id: inst.contract.id },
                  select: { contractNumber: true, rescheduleAdvanceBalance: true },
                });
                if (fresh) {
                  await alarmResidualParkOnCompletion(
                    this.prisma,
                    this.logger,
                    inst.contract.id,
                    fresh,
                  );
                }
              }
            }
          } catch (e) {
            // Never let the alarm break the accrual cron (same rule as R-1).
            Sentry.captureException(e, {
              tags: { subsystem: 'reschedule-park' },
              extra: { contractId: inst.contract.id, installmentScheduleId: inst.id },
            });
          }
        }
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
