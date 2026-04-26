import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const IDLE_HOURS_THRESHOLD = 2;

export interface CollectorStatus {
  id: string;
  name: string;
  isActive: boolean;
  callsToday: number;
  assignmentsToday: number;
  collectedToday: number;
  lastCallAt: string | null;
  status: 'on-track' | 'behind' | 'idle' | 'inactive';
}

export interface TeamAlert {
  type: 'idle_collector' | 'broken_promise_added' | 'pending_settlement';
  message: string;
  count?: number;
  collectorId?: string;
}

export interface TeamDashboardResponse {
  today: {
    totalCollected: number;
    callsMade: number;
    assignmentsTotal: number;
    promisesMade: number;
    brokenPromisesAdded: number;
  };
  collectors: CollectorStatus[];
  alerts: TeamAlert[];
}

@Injectable()
export class TeamDashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(branchScope?: string[]): Promise<TeamDashboardResponse> {
    const startOfToday = startOfDay(new Date());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

    // Active SALES collectors (scoped if BRANCH_MANAGER)
    const collectors = await this.prisma.user.findMany({
      where: {
        role: 'SALES' as any,
        deletedAt: null,
        ...(branchScope ? { branchId: { in: branchScope } } : {}),
      },
      select: { id: true, name: true, collectionsActive: true },
    });

    const collectorIds = collectors.map((c) => c.id);

    // Today's CallLogs (per collector)
    const todayCalls = collectorIds.length
      ? await this.prisma.callLog.groupBy({
          by: ['callerId'],
          where: {
            callerId: { in: collectorIds },
            calledAt: { gte: startOfToday, lt: endOfToday },
            deletedAt: null,
          },
          _count: { _all: true },
          _max: { calledAt: true },
        })
      : [];
    const callsByCollector = new Map(
      todayCalls.map((c) => [
        c.callerId!,
        { count: c._count._all, lastAt: c._max.calledAt },
      ]),
    );

    // Today's payments collected (link via Payment.recordedById, sum amountPaid)
    const todayPayments = collectorIds.length
      ? await this.prisma.payment.groupBy({
          by: ['recordedById'],
          where: {
            recordedById: { in: collectorIds },
            paidAt: { gte: startOfToday, lt: endOfToday },
            deletedAt: null,
          },
          _sum: { amountPaid: true },
        })
      : [];
    const collectedByCollector = new Map(
      todayPayments.map((p) => [p.recordedById!, Number(p._sum.amountPaid ?? 0)]),
    );

    // Today's DailyAssignment count per collector (the workload)
    const todayAssignments = collectorIds.length
      ? await this.prisma.dailyAssignment.groupBy({
          by: ['collectorId'],
          where: {
            collectorId: { in: collectorIds },
            date: startOfToday,
            deletedAt: null,
          },
          _count: { _all: true },
        })
      : [];
    const assignmentsByCollector = new Map(
      todayAssignments.map((a) => [a.collectorId!, a._count._all]),
    );

    // Today's promises (CallLog with PROMISED today)
    const promisesAgg = await this.prisma.callLog.count({
      where: {
        result: 'PROMISED',
        calledAt: { gte: startOfToday, lt: endOfToday },
        deletedAt: null,
        ...(collectorIds.length ? { callerId: { in: collectorIds } } : {}),
      },
    });

    // Broken promises set today
    const brokenAdded = await this.prisma.callLog.count({
      where: {
        brokenAt: { gte: startOfToday, lt: endOfToday },
        deletedAt: null,
        ...(collectorIds.length ? { callerId: { in: collectorIds } } : {}),
      },
    });

    // Build per-collector status
    const now = Date.now();
    const collectorStatuses: CollectorStatus[] = collectors.map((c) => {
      const callInfo = callsByCollector.get(c.id);
      const callsToday = callInfo?.count ?? 0;
      const assignments = assignmentsByCollector.get(c.id) ?? 0;
      const collected = collectedByCollector.get(c.id) ?? 0;
      const lastCallAt = callInfo?.lastAt?.toISOString() ?? null;

      let status: CollectorStatus['status'];
      if (!c.collectionsActive) status = 'inactive';
      else if (callsToday === 0 && assignments > 0) status = 'idle';
      else if (
        lastCallAt &&
        now - new Date(lastCallAt).getTime() > IDLE_HOURS_THRESHOLD * 60 * 60 * 1000 &&
        assignments > callsToday
      )
        status = 'idle';
      else if (assignments > 0 && callsToday < Math.floor(assignments * 0.5))
        status = 'behind';
      else status = 'on-track';

      return {
        id: c.id,
        name: c.name,
        isActive: c.collectionsActive,
        callsToday,
        assignmentsToday: assignments,
        collectedToday: collected,
        lastCallAt,
        status,
      };
    });

    // Aggregate today totals
    const totalCollected = collectorStatuses.reduce((s, c) => s + c.collectedToday, 0);
    const callsMade = collectorStatuses.reduce((s, c) => s + c.callsToday, 0);
    const assignmentsTotal = collectorStatuses.reduce((s, c) => s + c.assignmentsToday, 0);

    // Build alerts
    const alerts: TeamAlert[] = [];
    const idleCollectors = collectorStatuses.filter(
      (c) => c.status === 'idle' && c.isActive,
    );
    if (idleCollectors.length > 0) {
      alerts.push({
        type: 'idle_collector',
        message: `${idleCollectors.length} พนักงาน ยังไม่ได้โทรเลย หรือเงียบนานกว่า ${IDLE_HOURS_THRESHOLD} ชม.`,
        count: idleCollectors.length,
      });
    }
    if (brokenAdded > 0) {
      alerts.push({
        type: 'broken_promise_added',
        message: `${brokenAdded} ลูกค้าผิดนัดเพิ่มวันนี้`,
        count: brokenAdded,
      });
    }

    return {
      today: {
        totalCollected,
        callsMade,
        assignmentsTotal,
        promisesMade: promisesAgg,
        brokenPromisesAdded: brokenAdded,
      },
      collectors: collectorStatuses,
      alerts,
    };
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
