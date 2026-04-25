import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { bangkokStartOfDay } from '../../utils/date.util';

/**
 * Per-user "what have I done today?" KPI strip for the Collections page.
 *
 * Days are bucketed by **Asia/Bangkok wall-clock midnight** (not server UTC)
 * so the chips reset at the same moment the human operator considers
 * "tomorrow". `callsTarget` defaults to 20 — later it will come from
 * SystemConfig per-user (P3).
 *
 * Counts are scoped to the current user (the one looking at the page);
 * OWNER aggregate is **out of scope** for this version — OWNER sees the
 * same shape as everyone else (their own activity).
 */
@Injectable()
export class MyTodayKpiService {
  /** Default daily call target until per-user SystemConfig (P3). */
  private readonly DEFAULT_CALLS_TARGET = 20;

  constructor(private readonly prisma: PrismaService) {}

  async getMyToday(userId: string): Promise<{
    callsToday: number;
    callsTarget: number;
    lineSentToday: number;
    promisesKeptToday: number;
    collectedTodayBaht: string;
  }> {
    const startOfDay = bangkokStartOfDay();

    const [callsToday, lineSentToday, promisesKeptToday, collectedAgg] =
      await Promise.all([
        // Calls = CallLog rows the user logged today (any result)
        this.prisma.callLog.count({
          where: {
            callerId: userId,
            calledAt: { gte: startOfDay },
            deletedAt: null,
          },
        }),
        // LINE messages dispatched today by this user (executed_at since
        // start-of-day Bangkok). DunningAction with executedById = self
        // and channel = LINE.
        this.prisma.dunningAction.count({
          where: {
            channel: 'LINE',
            executedById: userId,
            executedAt: { gte: startOfDay },
            deletedAt: null,
          },
        }),
        // Promises that came due today and the customer actually paid.
        // Definition: CallLog with result='PROMISED' whose settlementDate
        // falls on today (Bangkok), AND the contract has a Payment that
        // moved to PAID on/after the settlementDate. Caller=self filter
        // attributes the kept promise to the collector who logged it.
        this.countPromisesKeptToday(userId, startOfDay),
        // Collected today = sum of Payment.amountPaid where
        // recordedById=self AND paidAt (or createdAt fallback) >= startOfDay
        // AND status=PAID (so we don't count partial echo of pending rows).
        this.prisma.payment.aggregate({
          where: {
            recordedById: userId,
            status: 'PAID',
            paidAt: { gte: startOfDay },
            deletedAt: null,
          },
          _sum: { amountPaid: true },
        }),
      ]);

    const collected = new Prisma.Decimal(collectedAgg._sum.amountPaid ?? 0);

    return {
      callsToday,
      callsTarget: this.DEFAULT_CALLS_TARGET,
      lineSentToday,
      promisesKeptToday,
      // String to preserve Decimal precision across the wire
      collectedTodayBaht: collected.toFixed(2),
    };
  }

  /**
   * "Promises kept today" = a promise whose settlementDate is today
   * (Bangkok) and the contract has a successful Payment recorded on/after
   * that settlementDate. Filtered to promises this user logged.
   *
   * We resolve in-process (not a single SQL) because the kept-promise rule
   * needs a per-row check against later Payment rows; the cardinality is
   * tiny (a single user logs <50 promises a day) so the N+1 cost is
   * negligible vs. the readability win.
   */
  private async countPromisesKeptToday(
    userId: string,
    startOfDay: Date,
  ): Promise<number> {
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.callLog.findMany({
      where: {
        callerId: userId,
        result: 'PROMISED',
        settlementDate: { gte: startOfDay, lt: endOfDay },
        deletedAt: null,
      },
      select: { contractId: true, settlementDate: true },
    });
    if (candidates.length === 0) return 0;

    let kept = 0;
    for (const c of candidates) {
      if (!c.settlementDate) continue;
      const paid = await this.prisma.payment.findFirst({
        where: {
          contractId: c.contractId,
          status: 'PAID',
          paidAt: { gte: c.settlementDate },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (paid) kept++;
    }
    return kept;
  }
}
