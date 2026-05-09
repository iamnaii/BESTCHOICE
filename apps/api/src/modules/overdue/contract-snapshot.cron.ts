import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ContractDailySnapshot cron — captures (daysOverdue, outstanding, status) for
 * every active overdue contract once per day. Feeds:
 *  - Trending arrow on ContractCard (Task 10): compare today vs ~7 days ago
 *  - Analytics historical trends (E1+)
 *
 * Schedule: daily 00:10 Bangkok = 17:10 UTC (cron timezone honored by
 * @nestjs/schedule, but `Cron('10 17 * * *', { timeZone })` makes intent explicit).
 *
 * Idempotency: `(contractId, date)` is unique. `createMany({ skipDuplicates })`
 * makes re-runs on the same UTC day a no-op.
 *
 * Pruning: rows older than 30 days are deleted each run. Trending arrow only
 * needs 7d history; 30d gives headroom for short historical charts. Anything
 * longer-term should be reported off the journal entries / payment records,
 * not these snapshots.
 *
 * Why compute from payments rather than read Contract columns: Contract has
 * NO daysOverdue / outstanding columns — they are derived per-request in
 * queue.service from the oldest unpaid Payment row. This cron mirrors that
 * derivation so snapshots stay consistent with the live queue view.
 */
@Injectable()
export class ContractSnapshotCron {
  private readonly logger = new Logger(ContractSnapshotCron.name);

  constructor(private readonly prisma: PrismaService) {}

  // Daily 00:10 Bangkok (UTC+7) → 17:10 UTC
  @Cron('10 17 * * *', { timeZone: 'Asia/Bangkok' })
  async runDaily(): Promise<{ snapshotted: number; pruned: number }> {
    try {
      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      // Fetch all active overdue contracts + their oldest unpaid payment.
      // Mirror of queue.service.ts toRow() derivation.
      const contracts = await this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          status: { in: ['OVERDUE', 'DEFAULT', 'TERMINATED'] },
          // Must have at least one unpaid past-due payment to qualify as
          // "active overdue" (mirrors queue tab filter).
          payments: {
            some: {
              dueDate: { lte: now },
              status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            },
          },
        },
        select: {
          id: true,
          status: true,
          payments: {
            where: {
              dueDate: { lte: now },
              status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            },
            orderBy: { dueDate: 'asc' },
            take: 1,
            select: {
              dueDate: true,
              amountDue: true,
              amountPaid: true,
              lateFee: true,
            },
          },
        },
      });

      const rows = contracts
        .map((c) => {
          const p = c.payments[0];
          if (!p) return null;
          const daysOverdue = Math.max(
            0,
            Math.floor((now.getTime() - new Date(p.dueDate).getTime()) / 86400000),
          );
          if (daysOverdue <= 0) return null;
          const outstanding = new Prisma.Decimal(p.amountDue)
            .sub(p.amountPaid)
            .add(p.lateFee);
          return {
            contractId: c.id,
            date: today,
            daysOverdue,
            outstanding,
            status: c.status,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      let snapshotted = 0;
      if (rows.length > 0) {
        const result = await this.prisma.contractDailySnapshot.createMany({
          data: rows,
          skipDuplicates: true,
        });
        snapshotted = result.count;
      }

      // Prune snapshots older than 30 days. Trending arrow needs only 7d;
      // 30d retention gives headroom for short trend charts without
      // unbounded growth.
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - 30);
      const pruneResult = await this.prisma.contractDailySnapshot.deleteMany({
        where: { date: { lt: cutoff } },
      });
      const pruned = pruneResult.count;

      this.logger.log(
        `Snapshotted ${snapshotted}/${rows.length} contracts; pruned ${pruned} rows older than ${cutoff.toISOString().slice(0, 10)}`,
      );

      Sentry.captureMessage(
        `ContractSnapshot cron snapshotted ${snapshotted} contract(s)`,
        {
          level: 'info',
          tags: { kind: 'cron-job', cron: 'contract-snapshot' },
          extra: { snapshotted, candidates: rows.length, pruned },
        },
      );

      return { snapshotted, pruned };
    } catch (err) {
      this.logger.error(
        `Contract snapshot cron failed: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'cron-job', cron: 'contract-snapshot' },
      });
      throw err;
    }
  }
}
