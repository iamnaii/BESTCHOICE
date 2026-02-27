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
          paidDate: {
            gte: new Date(new Date().toISOString().split('T')[0]),
            lt: new Date(new Date().getTime() + 24 * 60 * 60 * 1000),
          },
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
    const [overdueByBranch, paymentsByBranch] = await Promise.all([
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
}
