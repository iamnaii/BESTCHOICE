import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CommissionService } from './commission.service';

/**
 * Daily commission clawback cron (T1-C6).
 *
 * T2-C6 shipped the clawback *policy* (`applyClawbackForContract`) but nothing
 * was wired to call it. This cron finds every DEFAULT / CLOSED_BAD_DEBT
 * contract that still has APPROVED or PAID commissions with `clawbackAt IS
 * NULL`, computes `monthsPaid` from the count of PAID payments, and invokes
 * the clawback service.
 *
 * The service itself is idempotent (rows already clawed back are filtered out
 * by the `clawbackAt: null` predicate). A second cron pass on the same contract
 * is a no-op.
 *
 * Sentry capture on per-contract exception — we do NOT rethrow, so one broken
 * contract does not stop the entire batch.
 */
@Injectable()
export class CommissionClawbackCron {
  private readonly logger = new Logger(CommissionClawbackCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commission: CommissionService,
  ) {}

  /** Runs 02:00 Asia/Bangkok — after billing + before morning ops. */
  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async runDailyClawback(): Promise<{
    processed: number;
    clawedBackCount: number;
    errors: number;
  }> {
    try {
      const contracts = await this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          status: { in: ['DEFAULT', 'CLOSED_BAD_DEBT'] },
          commissions: {
            some: {
              deletedAt: null,
              status: { in: ['APPROVED', 'PAID'] },
              clawbackAt: null,
            },
          },
        },
        select: { id: true, contractNumber: true, status: true },
        take: 500, // safety cap; re-run tomorrow if backlog
      });

      if (contracts.length === 0) {
        this.logger.log('Commission clawback: no eligible contracts');
        return { processed: 0, clawedBackCount: 0, errors: 0 };
      }

      let processed = 0;
      let clawedBackCount = 0;
      let errors = 0;

      for (const contract of contracts) {
        try {
          const monthsPaid = await this.prisma.payment.count({
            where: {
              contractId: contract.id,
              status: 'PAID',
              deletedAt: null,
            },
          });

          const reason = `Auto-clawback on contract.status=${contract.status}`;
          const result = await this.commission.applyClawbackForContract(
            contract.id,
            monthsPaid,
            reason,
          );
          processed++;
          clawedBackCount += result.clawedBackCount;

          if (result.clawedBackCount > 0) {
            this.logger.log(
              `Clawback ${contract.contractNumber}: ${result.clawedBackCount} commissions, ${result.percent}%, ฿${result.totalAmount}`,
            );
          }
        } catch (err) {
          errors++;
          this.logger.error(
            `Clawback failed for ${contract.contractNumber}: ${err instanceof Error ? err.message : err}`,
          );
          Sentry.captureException(err, {
            tags: {
              kind: 'cron-job',
              cron: 'commission-clawback',
              contractNumber: contract.contractNumber,
            },
          });
        }
      }

      this.logger.log(
        `Clawback cron: processed ${processed}/${contracts.length} contracts, ${clawedBackCount} commissions clawed back, ${errors} errors`,
      );
      return { processed, clawedBackCount, errors };
    } catch (err) {
      this.logger.error(
        `Clawback cron failed at top level: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'commission-clawback' },
      });
      return { processed: 0, clawedBackCount: 0, errors: 0 };
    }
  }
}
