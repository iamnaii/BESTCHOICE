import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * P1 Task 14 — Broken-promise auto-suggest cron.
 *
 * Runs daily 09:00 Bangkok (UTC+7) = 02:00 UTC. Scans CallLogs whose
 * `result='PROMISED'` and `settlementDate` falls TODAY (Bangkok wall clock)
 * and the underlying contract is still overdue + has not yet been paid for
 * that promise (`brokenAt IS NULL`). For each, stamps a `DunningAction` with
 * the system rule `dunning-event-PROMISE_DUE_REMINDER` so the PromiseTab
 * banner (`BrokenPromiseBanner.tsx`) can surface "วันนี้มีนัดครบกำหนด N ราย"
 * and prompt the collector to bulk-send a LINE reminder.
 *
 * NOT to be confused with the existing `BrokenPromiseCron` (hourly, top of
 * hour) which flags promises whose settlementDate has ALREADY PASSED. This
 * cron prompts BEFORE the promise breaks, the other one cleans up AFTER.
 *
 * Idempotency: the DunningAction unique index `(dunningRuleId, contractId,
 * paymentId)` together with the day-bounded scan means re-running the cron
 * the same day is a no-op for contracts that already have a reminder. We
 * intentionally pass `paymentId` from the CallLog's contract's oldest unpaid
 * payment so the unique key resets when the next installment becomes due.
 *
 * Failure mode: any error (DB / unique conflict / etc) is logged + sent to
 * Sentry but does NOT throw — losing one day's suggestions is recoverable
 * via the next run; throwing would mark the schedule as failed and we'd
 * lose visibility into other crons in the same process.
 */
@Injectable()
export class BrokenPromiseReminderCron {
  private readonly logger = new Logger(BrokenPromiseReminderCron.name);
  private static readonly RULE_ID = 'dunning-event-PROMISE_DUE_REMINDER';

  constructor(private readonly prisma: PrismaService) {}

  // Daily 09:00 Bangkok (UTC+7) → 02:00 UTC. The @nestjs/schedule library
  // honours timeZone, but the explicit UTC equivalent in the comment helps
  // ops debug Cloud Run logs which display in UTC.
  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async runDaily(): Promise<{ suggested: number; skipped: number }> {
    try {
      // Compute Bangkok-local "today" window. Server may run in UTC; we
      // convert by treating now as UTC and shifting +7h, then taking the
      // calendar date — which is the Bangkok date the collector expects.
      const now = new Date();
      const bkkNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      const startOfDayBkk = new Date(
        Date.UTC(bkkNow.getUTCFullYear(), bkkNow.getUTCMonth(), bkkNow.getUTCDate(), 0, 0, 0, 0),
      );
      // Convert back from "naive Bangkok" to UTC by subtracting +7h.
      const startOfDayUtc = new Date(startOfDayBkk.getTime() - 7 * 60 * 60 * 1000);
      const endOfDayUtc = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000);

      // Verify the system rule exists — if seed hasn't run, abort with a
      // clear Sentry message instead of mass-FK-violating.
      const rule = await this.prisma.dunningRule.findUnique({
        where: { id: BrokenPromiseReminderCron.RULE_ID },
      });
      if (!rule) {
        const msg = `Missing system DunningRule '${BrokenPromiseReminderCron.RULE_ID}' — run seedCollectionsFoundation`;
        this.logger.error(msg);
        Sentry.captureMessage(msg, {
          level: 'error',
          tags: { kind: 'cron-job', cron: 'broken-promise-reminder', step: 'rule-missing' },
        });
        return { suggested: 0, skipped: 0 };
      }

      // Find PROMISED CallLogs whose settlementDate is today AND the contract
      // is still overdue AND brokenAt is null (i.e. payment hasn't landed yet).
      const candidates = await this.prisma.callLog.findMany({
        where: {
          deletedAt: null,
          result: 'PROMISED',
          brokenAt: null,
          settlementDate: { gte: startOfDayUtc, lt: endOfDayUtc },
          contract: {
            deletedAt: null,
            status: { in: ['OVERDUE', 'DEFAULT'] },
          },
        },
        select: {
          id: true,
          contractId: true,
          settlementDate: true,
          contract: {
            select: {
              payments: {
                where: {
                  deletedAt: null,
                  status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
                },
                orderBy: { dueDate: 'asc' },
                take: 1,
                select: { id: true },
              },
            },
          },
        },
        take: 1000,
      });

      if (candidates.length === 0) {
        return { suggested: 0, skipped: 0 };
      }

      // Dedup at cron level too — multiple CallLogs may exist per contract
      // (re-promise after re-promise). One reminder per contract.
      const seen = new Set<string>();
      let suggested = 0;
      let skipped = 0;

      for (const c of candidates) {
        if (seen.has(c.contractId)) {
          skipped++;
          continue;
        }
        seen.add(c.contractId);

        const oldestUnpaidId = c.contract.payments[0]?.id ?? null;

        try {
          await this.prisma.dunningAction.create({
            data: {
              dunningRuleId: BrokenPromiseReminderCron.RULE_ID,
              contractId: c.contractId,
              paymentId: oldestUnpaidId,
              channel: 'INTERNAL_ALERT',
              status: 'PENDING',
              messageContent: `นัดชำระวันนี้ (${(c.settlementDate as Date).toISOString().slice(0, 10)})`,
            },
          });
          suggested++;
        } catch (err) {
          // Unique conflict on (ruleId, contractId, paymentId) means a
          // reminder already exists for this contract+payment today — that's
          // the idempotent re-run case, not a real failure. Anything else
          // forward to Sentry.
          const code = (err as { code?: string })?.code;
          if (code === 'P2002') {
            skipped++;
            continue;
          }
          Sentry.captureException(err, {
            tags: { kind: 'cron-job', cron: 'broken-promise-reminder', step: 'createAction' },
            extra: { contractId: c.contractId, paymentId: oldestUnpaidId },
          });
          skipped++;
        }
      }

      this.logger.log(
        `Promise-due reminder: suggested ${suggested}, skipped ${skipped} (over ${candidates.length} candidate call log(s))`,
      );

      Sentry.captureMessage(
        `Broken-promise-reminder cron suggested ${suggested} contract(s)`,
        {
          level: 'info',
          tags: { kind: 'cron-job', cron: 'broken-promise-reminder' },
          extra: { suggested, skipped, candidates: candidates.length },
        },
      );

      return { suggested, skipped };
    } catch (err) {
      this.logger.error(
        `Broken-promise-reminder cron failed: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'broken-promise-reminder' },
      });
      return { suggested: 0, skipped: 0 };
    }
  }
}
