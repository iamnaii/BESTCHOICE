import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { DunningEngineService } from '../dunning-engine.service';

/**
 * Broken-promise cron — flags promise-to-pay entries (CallLog.result='PROMISED')
 * where settlementDate has passed but the underlying contract is still overdue.
 *
 * Runs hourly (top of the hour). Sets CallLog.brokenAt=now — idempotent via
 * the `brokenAt is null` filter so re-runs don't re-flag.
 *
 * Why matter: broken-promise count per contract feeds into dunning-stage
 * escalation and credit-check for the customer's next purchase. Without this
 * cron, broken promises accumulate silently and the collector sees nothing in
 * the CRM.
 */
@Injectable()
export class BrokenPromiseCron {
  private readonly logger = new Logger(BrokenPromiseCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dunningEngine: DunningEngineService,
  ) {}

  @Cron('0 * * * *', { timeZone: 'Asia/Bangkok' })
  async flagBrokenPromises(): Promise<{ flagged: number }> {
    try {
      const now = new Date();

      const candidates = await this.prisma.callLog.findMany({
        where: {
          deletedAt: null,
          result: 'PROMISED',
          brokenAt: null,
          settlementDate: { lt: now },
          contract: {
            deletedAt: null,
            status: { in: ['OVERDUE', 'DEFAULT'] },
          },
        },
        select: { id: true, contractId: true, settlementDate: true },
        take: 500,
      });

      if (candidates.length === 0) {
        return { flagged: 0 };
      }

      const ids = candidates.map((c) => c.id);
      await this.prisma.callLog.updateMany({
        where: { id: { in: ids } },
        data: { brokenAt: now },
      });

      // Fire BROKEN_PROMISE event per unique contract — customer gets a LINE nudge.
      // Dedup window in executeEventTrigger (4h) prevents spam when multiple
      // call logs for the same contract break at once. Non-fatal — flag stands
      // even if LINE send fails.
      const uniqueContractIds = Array.from(new Set(candidates.map((c) => c.contractId)));
      for (const contractId of uniqueContractIds) {
        try {
          await this.dunningEngine.executeEventTrigger('BROKEN_PROMISE', contractId, null, null);
        } catch (evErr) {
          Sentry.captureException(evErr, {
            tags: { cron: 'broken-promise', step: 'executeEventTrigger' },
            extra: { contractId },
          });
        }
      }

      this.logger.warn(`Flagged ${candidates.length} broken promise(s) across ${uniqueContractIds.length} contract(s)`);

      Sentry.captureMessage(
        `Broken-promise cron flagged ${candidates.length} entries`,
        {
          level: 'info',
          tags: { kind: 'cron-job', cron: 'broken-promise' },
          extra: { count: candidates.length, contractIds: candidates.map((c) => c.contractId) },
        },
      );

      return { flagged: candidates.length };
    } catch (err) {
      this.logger.error(`Broken-promise cron failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'broken-promise' } });
      return { flagged: 0 };
    }
  }
}
