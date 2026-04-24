import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type QueueTab = 'today' | 'followup' | 'promise';

@Injectable()
export class OverdueQueueService {
  constructor(private prisma: PrismaService) {}

  async getQueue(params: {
    tab: QueueTab;
    userRole: string;
    userBranchId: string | null;
    branchId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 100);
    const skip = (page - 1) * limit;
    const now = new Date();

    const branchScope: Prisma.ContractWhereInput =
      params.userRole === 'SALES' || params.userRole === 'BRANCH_MANAGER'
        ? { branchId: params.userBranchId ?? undefined }
        : params.branchId
        ? { branchId: params.branchId }
        : {};

    const where = this.buildWhere(params.tab, now, branchScope);

    // Fetch all matching then sort by priority score in memory, then paginate.
    // We can't express the priority formula as a Prisma orderBy (it involves a
    // computed expression across payments + callLogs + counters). Acceptable
    // tradeoff: the overdue set is bounded by branch scope and status filter
    // to ~thousands at most in practice.
    const [contracts, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true, lineId: true } },
          branch: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
          payments: {
            where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] } },
            orderBy: { dueDate: 'asc' },
            take: 1,
          },
          callLogs: {
            orderBy: { calledAt: 'desc' },
            take: 1,
          },
          // For broken-promise multiplier in priority score
          _count: {
            select: {
              callLogs: { where: { result: 'PROMISED', brokenAt: { not: null } } },
            },
          },
        },
        take: 500, // cap the fetch — priority sort + pagination happens in memory
      }),
      this.prisma.contract.count({ where }),
    ]);

    const rows = contracts
      .map((c) => this.toRow(c, now))
      .sort((a, b) => b.__priorityScore - a.__priorityScore);

    const paged = rows.slice(skip, skip + limit).map(({ __priorityScore, ...rest }) => rest);

    return { data: paged, total, page, limit };
  }

  /**
   * Priority = outstanding × daysOverdue × (noAnswerCount+1) × brokenPromiseMultiplier.
   * Larger score = higher urgency. Broken promises weigh 2× per occurrence to
   * surface serial promise-breakers first.
   */
  private priorityScore(
    outstanding: number,
    daysOverdue: number,
    noAnswerCount: number,
    brokenPromiseCount: number,
  ): number {
    const brokenMul = 1 + brokenPromiseCount * 2;
    return Math.max(0, outstanding) * Math.max(0, daysOverdue) * (noAnswerCount + 1) * brokenMul;
  }

  private buildWhere(
    tab: QueueTab,
    now: Date,
    branchScope: Prisma.ContractWhereInput,
  ): Prisma.ContractWhereInput {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    if (tab === 'today') {
      return {
        ...branchScope,
        status: { in: ['ACTIVE', 'OVERDUE'] },
        deletedAt: null,
        OR: [{ blockAutoEscalation: null }, { blockAutoEscalation: { lt: now } }],
        payments: {
          some: {
            dueDate: { lte: now },
            status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
          },
        },
        callLogs: {
          none: { calledAt: { gte: startOfDay } },
        },
      };
    }

    if (tab === 'followup') {
      return {
        ...branchScope,
        status: { in: ['OVERDUE', 'DEFAULT'] },
        deletedAt: null,
        noAnswerCount: { gte: 1, lt: 3 },
      };
    }

    // promise
    const todayMinus3 = new Date(now.getTime() - 3 * 86400000);
    const todayPlus30 = new Date(now.getTime() + 30 * 86400000);
    return {
      ...branchScope,
      deletedAt: null,
      callLogs: {
        some: {
          result: { in: ['PROMISED', 'ANSWERED'] },
          settlementDate: { gte: todayMinus3, lte: todayPlus30 },
        },
      },
    };
  }

  private toRow(c: any, now: Date) {
    const payment = c.payments[0];
    const callLog = c.callLogs[0];
    const outstanding = payment
      ? new Prisma.Decimal(payment.amountDue)
          .sub(payment.amountPaid)
          .add(payment.lateFee)
          .toNumber()
      : 0;
    const daysOverdue = payment
      ? Math.max(0, Math.floor((now.getTime() - new Date(payment.dueDate).getTime()) / 86400000))
      : 0;
    const brokenPromiseCount = c._count?.callLogs ?? 0;
    const __priorityScore = this.priorityScore(outstanding, daysOverdue, c.noAnswerCount ?? 0, brokenPromiseCount);
    return {
      id: c.id,
      contractNumber: c.contractNumber,
      status: c.status,
      dunningStage: c.dunningStage,
      customer: c.customer,
      branch: c.branch,
      assignedTo: c.assignedTo,
      outstanding,
      daysOverdue,
      lastCallResult: callLog?.result ?? null,
      lastCallAt: callLog?.calledAt ?? null,
      noAnswerCount: c.noAnswerCount,
      settlementDate: callLog?.settlementDate ?? null,
      needsSkipTracing: c.needsSkipTracing,
      deviceLocked: c.deviceLocked,
      __priorityScore,
    };
  }
}
