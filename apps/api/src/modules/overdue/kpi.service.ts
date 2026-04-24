import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OverdueKpiService {
  private cache = new Map<string, { value: any; expiresAt: number }>();
  private CACHE_TTL_MS = 60_000;

  constructor(private prisma: PrismaService) {}

  async getKpi(params: { range: '7d' | '30d'; userRole: string; userBranchId: string | null }) {
    const cacheKey = `${params.userRole}:${params.userBranchId ?? 'any'}:${params.range}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;

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
    const today = new Date(nowDate);
    today.setHours(0, 0, 0, 0);

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

    // Promise-kept resolution: check if a payment was made on or after the settlementDate
    let keptCount = 0;
    for (const c of keptCandidates) {
      const paid = await this.prisma.payment.findFirst({
        where: {
          contractId: c.contractId,
          status: 'PAID',
          updatedAt: { gte: c.settlementDate as Date },
        },
      });
      if (paid) keptCount++;
    }
    const promiseKeptRate7d = totalPromised > 0 ? keptCount / totalPromised : 0;

    const avgCollectorWorkload =
      workloadBuckets.length > 0
        ? workloadBuckets.reduce((s, b) => s + b._count._all, 0) / workloadBuckets.length
        : 0;

    // Per-collector breakdown — only computed for OWNER to avoid over-fetching
    const workloadWithNames =
      params.userRole === 'OWNER' && workloadBuckets.length > 0
        ? await this.prisma.user.findMany({
            where: {
              id: {
                in: workloadBuckets
                  .map((b) => b.assignedToId)
                  .filter((id): id is string => id !== null),
              },
              deletedAt: null,
            },
            select: { id: true, name: true },
          })
        : [];

    const collectorWorkload: Array<{ userId: string; name: string; count: number }> =
      params.userRole === 'OWNER'
        ? workloadBuckets
            .filter((b): b is typeof b & { assignedToId: string } => b.assignedToId !== null)
            .map((b) => ({
              userId: b.assignedToId,
              name: workloadWithNames.find((u) => u.id === b.assignedToId)?.name ?? '(unknown)',
              count: b._count._all,
            }))
            .sort((a, b) => b.count - a.count)
        : [];

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
      collectorWorkload,
    };
  }
}
