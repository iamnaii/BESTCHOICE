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
   */
  async getMonthlyTrend(branchId?: string) {
    const months: { month: string; newContracts: number; paymentsReceived: number }[] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthLabel = start.toLocaleDateString('th-TH', { year: '2-digit', month: 'short' });

      const branchFilter = branchId ? { branchId } : {};

      const [newContracts, payments] = await Promise.all([
        this.prisma.contract.count({
          where: { createdAt: { gte: start, lt: end }, deletedAt: null, ...branchFilter },
        }),
        this.prisma.payment.aggregate({
          where: {
            paidDate: { gte: start, lt: end },
            status: 'PAID',
            contract: { ...branchFilter },
          },
          _sum: { amountPaid: true },
        }),
      ]);

      months.push({
        month: monthLabel,
        newContracts,
        paymentsReceived: Number(payments._sum.amountPaid || 0),
      });
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
        ? c.payments.reduce((oldest, p) => (new Date(p.dueDate) < oldest ? new Date(p.dueDate) : oldest), new Date())
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
   */
  async getStatusDistribution(branchId?: string) {
    const branchFilter = branchId ? { branchId } : {};
    const statuses = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF', 'EXCHANGED', 'CLOSED_BAD_DEBT'] as const;

    const counts = await Promise.all(
      statuses.map(async (status) => ({
        status,
        count: await this.prisma.contract.count({
          where: { status, deletedAt: null, ...branchFilter },
        }),
      })),
    );

    return counts;
  }

  /**
   * Branch comparison summary
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

    const results = await Promise.all(
      branches.map(async (branch) => {
        const [overdue, payments] = await Promise.all([
          this.prisma.contract.count({
            where: { branchId: branch.id, status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null },
          }),
          this.prisma.payment.aggregate({
            where: {
              paidDate: {
                gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              },
              status: 'PAID',
              contract: { branchId: branch.id },
            },
            _sum: { amountPaid: true },
          }),
        ]);

        return {
          id: branch.id,
          name: branch.name,
          contracts: branch._count.contracts,
          products: branch._count.products,
          users: branch._count.users,
          overdueContracts: overdue,
          monthlyPayments: Number(payments._sum.amountPaid || 0),
        };
      }),
    );

    return results;
  }
}
