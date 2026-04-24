import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { bangkokStartOfDay } from '../../utils/date.util';

export interface KpiResult {
  totalOutstanding: number;
  totalLateFees: number;
  queueToday: number;
  queueTodayTrend: number;
  promisedCount: number;
  promiseKeptRate7d: number;
  avgCollectorWorkload: number;
}

@Injectable()
export class OverdueKpiService {
  // H2 fix: bounded TTL cache with capacity cap + explicit invalidate().
  // Previously the Map grew unbounded and had no write-side invalidation — a
  // freshly-recorded payment didn't show up for 60s. Now callers (payment
  // recording, log-contact) can invalidate when state changes, and the cache
  // self-bounds to avoid memory creep.
  private cache = new Map<string, { value: KpiResult; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 60_000;
  private readonly CACHE_MAX_ENTRIES = 200;

  constructor(private prisma: PrismaService) {}

  /**
   * Call from services that mutate collection-visible state (payment recorded,
   * contact logged, MDM approved, etc.) to drop stale KPI snapshots.
   */
  invalidate(): void {
    this.cache.clear();
  }

  async getKpi(params: {
    range: '7d' | '30d';
    userRole: string;
    userBranchId: string | null;
  }): Promise<KpiResult> {
    const cacheKey = `${params.userRole}:${params.userBranchId ?? 'any'}:${params.range}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;

    // Cap memory — evict oldest if we hit the ceiling before adding.
    if (this.cache.size >= this.CACHE_MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    const value = await this.compute(params);
    this.cache.set(cacheKey, { value, expiresAt: now + this.CACHE_TTL_MS });
    return value;
  }

  private async compute(params: {
    range: '7d' | '30d';
    userRole: string;
    userBranchId: string | null;
  }) {
    const nowDate = new Date();
    const sevenDaysAgo = new Date(nowDate.getTime() - 7 * 86400000);
    // Use Bangkok-local midnight, not server-TZ midnight. On Cloud Run (UTC),
    // setHours(0,0,0,0) flips the "today" boundary at 07:00 ICT — collectors
    // would see yesterday's queue all morning.
    const today = bangkokStartOfDay(nowDate);

    const branchScope: Prisma.ContractWhereInput =
      params.userRole === 'SALES' || params.userRole === 'BRANCH_MANAGER'
        ? { branchId: params.userBranchId ?? undefined }
        : {};

    const [outstanding, queueToday, promised, keptCandidates, totalPromised, workloadBuckets] =
      await Promise.all([
        this.prisma.payment.aggregate({
          where: {
            status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            dueDate: { lt: nowDate },
            contract: {
              status: { in: ['OVERDUE', 'DEFAULT'] },
              deletedAt: null,
              ...branchScope,
            },
          },
          _sum: { amountDue: true, amountPaid: true, lateFee: true },
        }),
        this.prisma.contract.count({
          where: {
            ...branchScope,
            status: { in: ['ACTIVE', 'OVERDUE'] },
            deletedAt: null,
            OR: [{ blockAutoEscalation: null }, { blockAutoEscalation: { lt: nowDate } }],
            payments: {
              some: {
                dueDate: { lte: nowDate },
                status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
              },
            },
            callLogs: { none: { calledAt: { gte: today } } },
          },
        }),
        this.prisma.callLog.count({
          where: {
            result: 'PROMISED',
            settlementDate: { gte: nowDate },
            contract: branchScope,
          },
        }),
        // Candidates for promise-kept rate (last 7d promises)
        this.prisma.callLog.findMany({
          where: {
            result: 'PROMISED',
            settlementDate: { gte: sevenDaysAgo, lte: nowDate },
            contract: branchScope,
          },
          select: {
            contractId: true,
            settlementDate: true,
          },
        }),
        this.prisma.callLog.count({
          where: {
            result: 'PROMISED',
            settlementDate: { gte: sevenDaysAgo, lte: nowDate },
            contract: branchScope,
          },
        }),
        params.userRole === 'OWNER'
          ? this.prisma.contract.groupBy({
              by: ['assignedToId'],
              where: {
                status: { in: ['OVERDUE', 'DEFAULT'] },
                deletedAt: null,
                assignedToId: { not: null },
              },
              _count: { _all: true },
            })
          : Promise.resolve([] as Array<{ assignedToId: string | null; _count: { _all: number } }>),
      ]);

    // C3 fix: promise-kept resolution in ONE query instead of N+1.
    // Previously: for each candidate, findFirst(paid after settlementDate).
    // Now: pull all PAID payments for these contracts since the earliest
    // settlementDate, match in-memory. O(N+M) instead of O(N×M) roundtrips.
    let keptCount = 0;
    if (keptCandidates.length > 0) {
      const earliest = keptCandidates.reduce(
        (min, c) => ((c.settlementDate as Date) < min ? (c.settlementDate as Date) : min),
        keptCandidates[0].settlementDate as Date,
      );
      const paidPayments = await this.prisma.payment.findMany({
        where: {
          contractId: { in: keptCandidates.map((c) => c.contractId) },
          status: 'PAID',
          updatedAt: { gte: earliest },
        },
        select: { contractId: true, updatedAt: true },
      });
      const paidByContract = new Map<string, Date[]>();
      for (const p of paidPayments) {
        const list = paidByContract.get(p.contractId) ?? [];
        list.push(p.updatedAt);
        paidByContract.set(p.contractId, list);
      }
      for (const c of keptCandidates) {
        const dates = paidByContract.get(c.contractId) ?? [];
        if (dates.some((d) => d >= (c.settlementDate as Date))) keptCount++;
      }
    }
    const promiseKeptRate7d = totalPromised > 0 ? keptCount / totalPromised : 0;

    const avgCollectorWorkload =
      workloadBuckets.length > 0
        ? workloadBuckets.reduce(
            (s: number, b: { _count: { _all: number } }) => s + b._count._all,
            0,
          ) / workloadBuckets.length
        : 0;

    const amountDue = new Prisma.Decimal(outstanding._sum.amountDue ?? 0);
    const amountPaid = new Prisma.Decimal(outstanding._sum.amountPaid ?? 0);
    const lateFees = new Prisma.Decimal(outstanding._sum.lateFee ?? 0);

    return {
      totalOutstanding: amountDue.sub(amountPaid).toNumber(),
      totalLateFees: lateFees.toNumber(),
      queueToday,
      queueTodayTrend: 0, // placeholder — no cache history yet
      promisedCount: promised,
      promiseKeptRate7d: Math.round(promiseKeptRate7d * 100) / 100,
      avgCollectorWorkload: Math.round(avgCollectorWorkload),
    };
  }
}
