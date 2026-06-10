import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class DashboardOpsService {
  constructor(private prisma: PrismaService) {}

  /**
   * SLA metrics: contract approval time + pending approvals > 20 min
   */
  async getSlaMetrics(branchId?: string) {
    const branchFilter = branchId ? { branchId } : {};
    const threshold20min = new Date(Date.now() - 20 * 60 * 1000);

    // Fetch contracts reviewed in last 30 days for approval time stats
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [reviewedContracts, pendingContracts] = await Promise.all([
      this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          reviewedAt: { not: null, gte: thirtyDaysAgo },
          ...branchFilter,
        },
        select: { createdAt: true, reviewedAt: true },
      }),
      this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          workflowStatus: { in: ['PENDING_REVIEW', 'CREATING'] },
          reviewedAt: null,
          ...branchFilter,
        },
        select: {
          contractNumber: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
      }),
    ]);

    // Calculate approval times in minutes
    const approvalMinutes = reviewedContracts
      .map((c) => (c.reviewedAt!.getTime() - c.createdAt.getTime()) / (1000 * 60))
      .sort((a, b) => a - b);

    const sampleCount = approvalMinutes.length;
    const avgMinutes = sampleCount > 0
      ? approvalMinutes.reduce((s, m) => s + m, 0) / sampleCount
      : 0;
    const p50Minutes = sampleCount > 0
      ? approvalMinutes[Math.floor(sampleCount * 0.5)]
      : 0;
    const p90Minutes = sampleCount > 0
      ? approvalMinutes[Math.floor(sampleCount * 0.9)]
      : 0;

    // Pending contracts with their wait times
    const pendingList = pendingContracts.map((c) => ({
      contractNumber: c.contractNumber,
      customerName: c.customer?.name || '-',
      pendingMinutes: Math.round((Date.now() - c.createdAt.getTime()) / (1000 * 60)),
    }));

    const over20MinList = pendingList.filter((c) => c.pendingMinutes > 20);

    return {
      approvalTime: {
        avgMinutes: Math.round(avgMinutes * 10) / 10,
        p50Minutes: Math.round(p50Minutes * 10) / 10,
        p90Minutes: Math.round(p90Minutes * 10) / 10,
        sampleCount,
      },
      pendingApprovals: {
        totalCount: pendingContracts.length,
        over20MinCount: over20MinList.length,
        contracts: over20MinList,
      },
    };
  }

  async computeAlerts(branchId?: string) {
    const branchFilter = branchId ? { branchId } : {};

    const [
      overdueCount,
      defaultCount,
      pendingContractsCount,
      pendingEvidenceCount,
      activeStockAlerts,
    ] = await Promise.all([
      this.prisma.contract.count({
        where: { status: 'OVERDUE', deletedAt: null, ...branchFilter },
      }),
      this.prisma.contract.count({
        where: { status: 'DEFAULT', deletedAt: null, ...branchFilter },
      }),
      this.prisma.contract.count({
        where: {
          deletedAt: null,
          workflowStatus: { in: ['PENDING_REVIEW', 'CREATING'] },
          reviewedAt: null,
          ...branchFilter,
        },
      }),
      this.prisma.paymentEvidence.count({
        where: {
          status: 'PENDING_REVIEW',
          contract: { deletedAt: null, ...branchFilter },
        },
      }),
      this.prisma.stockAlert.count({
        where: {
          status: 'ACTIVE',
          ...(branchId ? { reorderPoint: { branchId } } : {}),
        },
      }),
    ]);

    const alerts: {
      type: string;
      severity: 'critical' | 'warning' | 'info';
      message: string;
      link: string;
      count: number;
    }[] = [];

    const totalOverdue = overdueCount + defaultCount;
    if (totalOverdue > 0) {
      alerts.push({
        type: 'overdue',
        severity: totalOverdue >= 10 ? 'critical' : 'warning',
        message: `มี ${totalOverdue} สัญญาค้างชำระ`,
        link: '/overdue',
        count: totalOverdue,
      });
    }

    if (activeStockAlerts > 0) {
      alerts.push({
        type: 'low_stock',
        severity: 'warning',
        message: `สินค้าใกล้หมด ${activeStockAlerts} รายการ`,
        link: '/stock?tab=alerts',
        count: activeStockAlerts,
      });
    }

    if (pendingContractsCount > 0) {
      alerts.push({
        type: 'pending_contracts',
        severity: 'info',
        message: `มี ${pendingContractsCount} สัญญารออนุมัติ`,
        link: '/contracts',
        count: pendingContractsCount,
      });
    }

    if (pendingEvidenceCount > 0) {
      alerts.push({
        type: 'payment_mismatch',
        severity: pendingEvidenceCount >= 5 ? 'warning' : 'info',
        message: `มี ${pendingEvidenceCount} สลิปรอตรวจสอบ`,
        link: '/slip-review',
        count: pendingEvidenceCount,
      });
    }

    return alerts;
  }

  /**
   * Staff performance: sales metrics (current month) + recent activity (last 7 days)
   */
  async getStaffPerformance(branchId?: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const branchFilter = branchId ? { branchId } : {};

    // Sales metrics: contracts this month grouped by salesperson via Postgres groupBy
    // (replaces former findMany + JS reduce — old path loaded full monthly contract
    // set with deep includes; new path returns ~N rows where N = salesperson count).
    const baseWhere = {
      createdAt: { gte: monthStart, lt: monthEnd },
      deletedAt: null,
      ...branchFilter,
    } as const;

    const [aggregates, overdueAgg] = await Promise.all([
      this.prisma.contract.groupBy({
        by: ['salespersonId', 'branchId'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { sellingPrice: true },
      }),
      this.prisma.contract.groupBy({
        by: ['salespersonId'],
        where: { ...baseWhere, status: { in: ['OVERDUE', 'DEFAULT'] } },
        _count: { _all: true },
      }),
    ]);

    // Enrich names + branch names in two batched queries (vs N+1 in old loop).
    const salespersonIds = Array.from(
      new Set(aggregates.map((a) => a.salespersonId).filter((id): id is string => !!id)),
    );
    const branchIds = Array.from(
      new Set(aggregates.map((a) => a.branchId).filter((id): id is string => !!id)),
    );

    const [users, branches] = await Promise.all([
      salespersonIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: salespersonIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      branchIds.length
        ? this.prisma.branch.findMany({
            where: { id: { in: branchIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);

    const userNameMap = new Map(users.map((u) => [u.id, u.name]));
    const branchNameMap = new Map(branches.map((b) => [b.id, b.name]));
    const overdueMap = new Map(
      overdueAgg
        .filter((o) => !!o.salespersonId)
        .map((o) => [o.salespersonId as string, o._count._all]),
    );

    // Collapse [salespersonId, branchId] rows → one row per salesperson.
    // Matches old semantics: first contract's branch wins for the salesperson.
    type Bucket = {
      name: string;
      branch: string;
      totalContracts: number;
      totalSales: number;
      overdueCount: number;
    };
    const staffMap = new Map<string, Bucket>();
    for (const a of aggregates) {
      if (!a.salespersonId) continue;
      const key = a.salespersonId;
      const existing = staffMap.get(key);
      const sellingSum = new Prisma.Decimal(a._sum.sellingPrice ?? 0).toNumber();
      if (existing) {
        existing.totalContracts += a._count._all;
        existing.totalSales = new Prisma.Decimal(existing.totalSales)
          .add(new Prisma.Decimal(a._sum.sellingPrice ?? 0))
          .toNumber();
      } else {
        staffMap.set(key, {
          name: userNameMap.get(key) ?? '-',
          branch: branchNameMap.get(a.branchId) ?? '-',
          totalContracts: a._count._all,
          totalSales: sellingSum,
          overdueCount: overdueMap.get(key) ?? 0,
        });
      }
    }

    const salesMetrics = Array.from(staffMap.entries())
      .map(([id, data]) => ({
        salespersonId: id,
        ...data,
        overdueRate:
          data.totalContracts > 0
            ? Number(((data.overdueCount / data.totalContracts) * 100).toFixed(1))
            : 0,
      }))
      .sort((a, b) => b.totalSales - a.totalSales);

    // Recent activity: contracts created + payments recorded in last 7 days
    const [recentContracts, recentPayments] = await Promise.all([
      this.prisma.contract.findMany({
        where: { createdAt: { gte: weekAgo }, deletedAt: null, ...branchFilter },
        select: {
          id: true,
          contractNumber: true,
          sellingPrice: true,
          createdAt: true,
          salesperson: { select: { name: true } },
          customer: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.payment.findMany({
        where: {
          paidDate: { gte: weekAgo },
          status: 'PAID',
          contract: { deletedAt: null, ...branchFilter },
        },
        select: {
          id: true,
          amountPaid: true,
          paidDate: true,
          recordedBy: { select: { name: true } },
          contract: { select: { contractNumber: true, customer: { select: { name: true } } } },
        },
        orderBy: { paidDate: 'desc' },
        take: 10,
      }),
    ]);

    const recentActivity = [
      ...recentContracts.map((c) => ({
        id: c.id,
        type: 'contract_created' as const,
        userName: c.salesperson.name,
        description: `สร้างสัญญา ${c.contractNumber} — ${c.customer.name}`,
        amount: new Prisma.Decimal(c.sellingPrice ?? 0).toNumber(),
        createdAt: c.createdAt.toISOString(),
      })),
      ...recentPayments.map((p) => ({
        id: p.id,
        type: 'payment_recorded' as const,
        userName: p.recordedBy?.name || '-',
        description: `บันทึกชำระ ${p.contract.contractNumber} — ${p.contract.customer.name}`,
        amount: new Prisma.Decimal(p.amountPaid ?? 0).toNumber(),
        createdAt: p.paidDate?.toISOString() || new Date().toISOString(),
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);

    return { salesMetrics, recentActivity };
  }
}
