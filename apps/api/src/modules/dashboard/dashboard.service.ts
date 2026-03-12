import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get main dashboard KPIs
   */
  async getKPIs(branchId?: string) {
    const branchFilter: Prisma.ContractWhereInput = branchId ? { branchId } : {};
    const productBranchFilter: Prisma.ProductWhereInput = branchId ? { branchId } : {};

    const [
      totalContracts,
      activeContracts,
      overdueContracts,
      defaultContracts,
      completedContracts,
      totalProducts,
      inStockProducts,
    ] = await Promise.all([
      this.prisma.contract.count({ where: { deletedAt: null, ...branchFilter } }),
      this.prisma.contract.count({ where: { status: 'ACTIVE', deletedAt: null, ...branchFilter } }),
      this.prisma.contract.count({ where: { status: 'OVERDUE', deletedAt: null, ...branchFilter } }),
      this.prisma.contract.count({ where: { status: 'DEFAULT', deletedAt: null, ...branchFilter } }),
      this.prisma.contract.count({ where: { status: 'COMPLETED', deletedAt: null, ...branchFilter } }),
      this.prisma.product.count({ where: { deletedAt: null, ...productBranchFilter } }),
      this.prisma.product.count({ where: { status: 'IN_STOCK', deletedAt: null, ...productBranchFilter } }),
    ]);

    // Financial aggregates
    const [receivables, todayPayments] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
          contract: { deletedAt: null, status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] }, ...branchFilter },
        },
        _sum: { amountDue: true, amountPaid: true, lateFee: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          paidDate: (() => {
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            return { gte: startOfDay, lt: endOfDay };
          })(),
          status: 'PAID',
          contract: { ...branchFilter },
        },
        _sum: { amountPaid: true },
        _count: true,
      }),
    ]);

    const totalReceivable = Number(receivables._sum.amountDue || 0) - Number(receivables._sum.amountPaid || 0);
    const totalLateFees = Number(receivables._sum.lateFee || 0);
    const overdueRate = totalContracts > 0
      ? ((overdueContracts + defaultContracts) / totalContracts * 100).toFixed(1)
      : '0.0';

    return {
      contracts: { total: totalContracts, active: activeContracts, overdue: overdueContracts, default: defaultContracts, completed: completedContracts },
      products: { total: totalProducts, inStock: inStockProducts },
      financial: {
        totalReceivable,
        totalLateFees,
        todayPayments: Number(todayPayments._sum.amountPaid || 0),
        todayPaymentCount: todayPayments._count || 0,
      },
      overdueRate: Number(overdueRate),
    };
  }

  /**
   * Monthly trend: new contracts vs payments received (last 12 months)
   * OPTIMIZED: 2 batch queries instead of 24 sequential queries
   */
  async getMonthlyTrend(branchId?: string) {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const branchFilter = branchId ? { branchId } : {};

    // 2 batch queries instead of 24 sequential ones
    const [contracts, payments] = await Promise.all([
      this.prisma.contract.findMany({
        where: { createdAt: { gte: startDate }, deletedAt: null, ...branchFilter },
        select: { createdAt: true },
      }),
      this.prisma.payment.findMany({
        where: {
          paidDate: { gte: startDate },
          status: 'PAID',
          contract: { ...branchFilter },
        },
        select: { paidDate: true, amountPaid: true },
      }),
    ]);

    // Group results by month in JS (fast, in-memory)
    const months: { month: string; newContracts: number; paymentsReceived: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthLabel = start.toLocaleDateString('th-TH', { year: '2-digit', month: 'short' });

      const newContracts = contracts.filter(
        (c) => c.createdAt >= start && c.createdAt < end,
      ).length;

      const paymentsReceived = payments
        .filter((p) => p.paidDate && p.paidDate >= start && p.paidDate < end)
        .reduce((sum, p) => sum + Number(p.amountPaid), 0);

      months.push({ month: monthLabel, newContracts, paymentsReceived });
    }

    return months;
  }

  /**
   * Top 10 overdue customers
   */
  async getTopOverdue(branchId?: string) {
    const branchFilter = branchId ? { branchId } : {};

    const contracts = await this.prisma.contract.findMany({
      where: { status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null, ...branchFilter },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { name: true } },
        payments: {
          where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] } },
          select: { amountDue: true, amountPaid: true, lateFee: true, dueDate: true },
        },
      },
      take: 20,
    });

    const results = contracts.map((c) => {
      const totalOutstanding = c.payments.reduce(
        (sum, p) => sum + Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee), 0,
      );
      const oldestDue = c.payments.length > 0
        ? c.payments.reduce((oldest, p) => {
            const d = new Date(p.dueDate);
            return d < oldest ? d : oldest;
          }, new Date(c.payments[0].dueDate))
        : new Date();
      const daysOverdue = Math.max(0, Math.floor((Date.now() - oldestDue.getTime()) / (1000 * 60 * 60 * 24)));

      return {
        contractNumber: c.contractNumber,
        customer: c.customer,
        branch: c.branch.name,
        status: c.status,
        overdueInstallments: c.payments.length,
        totalOutstanding,
        daysOverdue,
      };
    });

    return results
      .sort((a, b) => b.totalOutstanding - a.totalOutstanding)
      .slice(0, 10);
  }

  /**
   * Contract status distribution
   * OPTIMIZED: 1 groupBy query instead of 7 separate count queries
   */
  async getStatusDistribution(branchId?: string) {
    const branchFilter = branchId ? { branchId } : {};

    const groups = await this.prisma.contract.groupBy({
      by: ['status'],
      where: { deletedAt: null, ...branchFilter },
      _count: true,
    });

    return groups.map((g) => ({
      status: g.status,
      count: g._count,
    }));
  }

  /**
   * Branch comparison summary
   * OPTIMIZED: batch queries instead of N+1 per branch
   */
  async getBranchComparison() {
    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        _count: { select: { contracts: true, products: true, users: true } },
      },
    });

    const branchIds = branches.map((b) => b.id);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    // 2 batch queries for all branches instead of 2 per branch
    const [overdueByBranch] = await Promise.all([
      this.prisma.contract.groupBy({
        by: ['branchId'],
        where: {
          branchId: { in: branchIds },
          status: { in: ['OVERDUE', 'DEFAULT'] },
          deletedAt: null,
        },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['contractId'],
        where: {
          paidDate: { gte: monthStart },
          status: 'PAID',
          contract: { branchId: { in: branchIds } },
        },
        _sum: { amountPaid: true },
      }),
    ]);

    // Build payment totals per branch via a second lightweight query
    const paidPayments = await this.prisma.payment.findMany({
      where: {
        paidDate: { gte: monthStart },
        status: 'PAID',
        contract: { branchId: { in: branchIds } },
      },
      select: { amountPaid: true, contract: { select: { branchId: true } } },
    });

    const paymentTotalByBranch = new Map<string, number>();
    for (const p of paidPayments) {
      const bid = p.contract.branchId;
      paymentTotalByBranch.set(bid, (paymentTotalByBranch.get(bid) || 0) + Number(p.amountPaid));
    }

    const overdueMap = new Map(overdueByBranch.map((o) => [o.branchId, o._count]));

    return branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      contracts: branch._count.contracts,
      products: branch._count.products,
      users: branch._count.users,
      overdueContracts: overdueMap.get(branch.id) || 0,
      monthlyPayments: paymentTotalByBranch.get(branch.id) || 0,
    }));
  }

  /**
   * Monthly revenue summary for current month
   */
  async getMonthlyRevenue(branchId?: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const branchFilter = branchId ? { branchId } : {};

    const [paidPayments, lateFeeAgg] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          paidDate: { gte: monthStart, lt: monthEnd },
          status: 'PAID',
          contract: { deletedAt: null, ...branchFilter },
        },
        select: {
          amountPaid: true,
          contract: { select: { interestTotal: true, totalMonths: true } },
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          paidDate: { gte: monthStart, lt: monthEnd },
          contract: { deletedAt: null, ...branchFilter },
        },
        _sum: { lateFee: true },
      }),
    ]);

    const totalPayments = paidPayments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
    const interestIncome = paidPayments.reduce((sum, p) => {
      const monthlyInterest = Number(p.contract.interestTotal) / p.contract.totalMonths;
      return sum + monthlyInterest;
    }, 0);

    return {
      totalPayments,
      interestIncome: Math.round(interestIncome),
      lateFeeIncome: Number(lateFeeAgg._sum.lateFee || 0),
      paymentCount: paidPayments.length,
    };
  }

  /**
   * Aging summary: overdue payments grouped by age buckets
   */
  async getAgingSummary(branchId?: string) {
    const now = new Date();
    const branchFilter = branchId
      ? { contract: { branchId, deletedAt: null } }
      : { contract: { deletedAt: null } };

    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
        dueDate: { lt: now },
        ...branchFilter,
      },
      select: { amountDue: true, amountPaid: true, lateFee: true, dueDate: true },
    });

    const bucketDefs = [
      { range: '1-30', min: 1, max: 30, color: 'green' },
      { range: '31-60', min: 31, max: 60, color: 'yellow' },
      { range: '61-90', min: 61, max: 90, color: 'orange' },
      { range: '90+', min: 91, max: Infinity, color: 'red' },
    ];

    const buckets = bucketDefs.map((def) => {
      const items = overduePayments.filter((p) => {
        const days = Math.floor((now.getTime() - new Date(p.dueDate).getTime()) / (1000 * 60 * 60 * 24));
        return days >= def.min && days <= def.max;
      });
      const amount = items.reduce((s, p) => s + Number(p.amountDue) - Number(p.amountPaid), 0);
      return { range: def.range, count: items.length, amount, color: def.color };
    });

    const totalCount = buckets.reduce((s, b) => s + b.count, 0);
    const totalAmount = buckets.reduce((s, b) => s + b.amount, 0);

    return { buckets, total: { count: totalCount, amount: totalAmount } };
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

    // Sales metrics: contracts this month grouped by salesperson
    const contracts = await this.prisma.contract.findMany({
      where: { createdAt: { gte: monthStart, lt: monthEnd }, deletedAt: null, ...branchFilter },
      include: {
        salesperson: { select: { id: true, name: true } },
        branch: { select: { name: true } },
      },
    });

    const staffMap = new Map<string, {
      name: string; branch: string; totalContracts: number;
      totalSales: number; overdueCount: number;
    }>();

    for (const c of contracts) {
      const key = c.salespersonId;
      const existing = staffMap.get(key) || {
        name: c.salesperson.name, branch: c.branch.name,
        totalContracts: 0, totalSales: 0, overdueCount: 0,
      };
      existing.totalContracts++;
      existing.totalSales += Number(c.sellingPrice);
      if (['OVERDUE', 'DEFAULT'].includes(c.status)) existing.overdueCount++;
      staffMap.set(key, existing);
    }

    const salesMetrics = Array.from(staffMap.entries()).map(([id, data]) => ({
      salespersonId: id,
      ...data,
      overdueRate: data.totalContracts > 0
        ? Number(((data.overdueCount / data.totalContracts) * 100).toFixed(1))
        : 0,
    })).sort((a, b) => b.totalSales - a.totalSales);

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
        amount: Number(c.sellingPrice),
        createdAt: c.createdAt.toISOString(),
      })),
      ...recentPayments.map((p) => ({
        id: p.id,
        type: 'payment_recorded' as const,
        userName: p.recordedBy?.name || '-',
        description: `บันทึกชำระ ${p.contract.contractNumber} — ${p.contract.customer.name}`,
        amount: Number(p.amountPaid),
        createdAt: p.paidDate?.toISOString() || new Date().toISOString(),
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);

    return { salesMetrics, recentActivity };
  }
}
