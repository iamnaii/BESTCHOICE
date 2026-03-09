import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Aging Report: group receivables by age buckets (1-30, 31-60, 61-90, 90+)
   */
  async getAgingReport(branchId?: string) {
    const now = new Date();
    const branchFilter = branchId ? { contract: { branchId, deletedAt: null } } : { contract: { deletedAt: null } };

    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
        dueDate: { lt: now },
        ...branchFilter,
      },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: { select: { name: true, phone: true } },
            branch: { select: { name: true } },
          },
        },
      },
    });

    const buckets = { '1-30': [] as typeof overduePayments, '31-60': [] as typeof overduePayments, '61-90': [] as typeof overduePayments, '90+': [] as typeof overduePayments };

    for (const p of overduePayments) {
      const days = Math.floor((now.getTime() - new Date(p.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      if (days <= 30) buckets['1-30'].push(p);
      else if (days <= 60) buckets['31-60'].push(p);
      else if (days <= 90) buckets['61-90'].push(p);
      else buckets['90+'].push(p);
    }

    const summarize = (items: typeof overduePayments) => ({
      count: items.length,
      totalOutstanding: items.reduce((s, p) => s + Number(p.amountDue) - Number(p.amountPaid), 0),
      totalLateFees: items.reduce((s, p) => s + Number(p.lateFee), 0),
    });

    return {
      '1-30': summarize(buckets['1-30']),
      '31-60': summarize(buckets['31-60']),
      '61-90': summarize(buckets['61-90']),
      '90+': summarize(buckets['90+']),
      total: summarize(overduePayments),
    };
  }

  /**
   * Revenue / Profit-Loss Report
   */
  async getRevenuePLReport(startDate: string, endDate: string, branchId?: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const branchFilter = branchId ? { branchId } : {};

    const [interestIncomePayments, lateFeeIncome, totalPayments, newContracts] = await Promise.all([
      // Calculate interest portion from payments actually received in this period
      // Interest per installment = contract.interestTotal / contract.totalMonths
      this.prisma.payment.findMany({
        where: {
          paidDate: { gte: start, lte: end },
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
          paidDate: { gte: start, lte: end },
          contract: { ...branchFilter },
        },
        _sum: { lateFee: true, amountPaid: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          paidDate: { gte: start, lte: end },
          status: 'PAID',
          contract: { ...branchFilter },
        },
        _sum: { amountPaid: true },
        _count: true,
      }),
      this.prisma.contract.count({
        where: { createdAt: { gte: start, lte: end }, deletedAt: null, ...branchFilter },
      }),
    ]);

    // Sum the interest portion of each payment received in this period
    const interestIncome = interestIncomePayments.reduce((sum, p) => {
      const monthlyInterest = Number(p.contract.interestTotal) / p.contract.totalMonths;
      return sum + monthlyInterest;
    }, 0);

    return {
      period: { start: startDate, end: endDate },
      revenue: {
        interestIncome: Math.round(interestIncome),
        lateFeeIncome: Number(lateFeeIncome._sum.lateFee || 0),
        totalPaymentsReceived: Number(totalPayments._sum.amountPaid || 0),
        paymentCount: totalPayments._count || 0,
      },
      contracts: { newContracts },
    };
  }

  /**
   * High-risk customers report
   */
  async getHighRiskCustomers(branchId?: string) {
    const branchFilter = branchId ? { branchId } : {};

    const customers = await this.prisma.contract.findMany({
      where: { status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null, ...branchFilter },
      include: {
        customer: { select: { id: true, name: true, phone: true, lineId: true } },
        branch: { select: { name: true } },
        payments: {
          where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] } },
          select: { amountDue: true, amountPaid: true, lateFee: true, dueDate: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return customers.map((c) => {
      const totalOutstanding = c.payments.reduce(
        (sum, p) => sum + Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee), 0,
      );
      const oldestDue = c.payments.reduce(
        (oldest, p) => (new Date(p.dueDate) < oldest ? new Date(p.dueDate) : oldest),
        new Date(),
      );
      return {
        contractNumber: c.contractNumber,
        status: c.status,
        customer: c.customer,
        branch: c.branch.name,
        overdueInstallments: c.payments.length,
        totalOutstanding,
        daysOverdue: Math.max(0, Math.floor((Date.now() - oldestDue.getTime()) / (1000 * 60 * 60 * 24))),
      };
    });
  }

  /**
   * Sales comparison by staff
   */
  async getSalesComparisonReport(startDate: string, endDate: string, branchId?: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const branchFilter = branchId ? { branchId } : {};

    const contracts = await this.prisma.contract.findMany({
      where: { createdAt: { gte: start, lte: end }, deletedAt: null, ...branchFilter },
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

    return Array.from(staffMap.entries()).map(([id, data]) => ({
      salespersonId: id,
      ...data,
      overdueRate: data.totalContracts > 0 ? ((data.overdueCount / data.totalContracts) * 100).toFixed(1) : '0.0',
    })).sort((a, b) => b.totalSales - a.totalSales);
  }

  /**
   * Branch comparison report
   */
  async getBranchComparisonReport(startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    return Promise.all(
      branches.map(async (branch) => {
        const [newContracts, activeContracts, overdueContracts, payments, products] = await Promise.all([
          this.prisma.contract.count({ where: { branchId: branch.id, createdAt: { gte: start, lte: end }, deletedAt: null } }),
          this.prisma.contract.count({ where: { branchId: branch.id, status: 'ACTIVE', deletedAt: null } }),
          this.prisma.contract.count({ where: { branchId: branch.id, status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null } }),
          this.prisma.payment.aggregate({
            where: { paidDate: { gte: start, lte: end }, status: 'PAID', contract: { branchId: branch.id } },
            _sum: { amountPaid: true },
          }),
          this.prisma.product.count({ where: { branchId: branch.id, status: 'IN_STOCK', deletedAt: null } }),
        ]);

        return {
          branchId: branch.id,
          branchName: branch.name,
          newContracts,
          activeContracts,
          overdueContracts,
          paymentsReceived: Number(payments._sum.amountPaid || 0),
          inStockProducts: products,
        };
      }),
    );
  }

  /**
   * Daily payment summary
   */
  async getDailyPaymentSummary(date: string, branchId?: string) {
    const start = new Date(date);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const branchFilter = branchId ? { contract: { branchId } } : {};

    const payments = await this.prisma.payment.findMany({
      where: {
        paidDate: { gte: start, lt: end },
        status: 'PAID',
        ...branchFilter,
      },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customer: { select: { name: true } },
            branch: { select: { name: true } },
          },
        },
        recordedBy: { select: { name: true } },
      },
      orderBy: { paidDate: 'asc' },
    });

    const byMethod: Record<string, { count: number; total: number }> = {};
    const byBranch: Record<string, { count: number; total: number }> = {};

    for (const p of payments) {
      const method = p.paymentMethod || 'CASH';
      if (!byMethod[method]) byMethod[method] = { count: 0, total: 0 };
      byMethod[method].count++;
      byMethod[method].total += Number(p.amountPaid);

      const branch = p.contract.branch.name;
      if (!byBranch[branch]) byBranch[branch] = { count: 0, total: 0 };
      byBranch[branch].count++;
      byBranch[branch].total += Number(p.amountPaid);
    }

    return {
      date,
      totalPayments: payments.length,
      totalAmount: payments.reduce((s, p) => s + Number(p.amountPaid), 0),
      byMethod,
      byBranch,
      payments: payments.map((p) => ({
        id: p.id,
        contractNumber: p.contract.contractNumber,
        customer: p.contract.customer.name,
        branch: p.contract.branch.name,
        installmentNo: p.installmentNo,
        amountPaid: Number(p.amountPaid),
        method: p.paymentMethod,
        recordedBy: p.recordedBy?.name || '-',
        paidAt: p.paidDate,
      })),
    };
  }

  /**
   * Stock report
   */
  async getStockReport(branchId?: string) {
    const branchFilter = branchId ? { branchId } : {};

    const products = await this.prisma.product.groupBy({
      by: ['status', 'branchId'],
      where: { deletedAt: null, ...branchFilter },
      _count: true,
    });

    const branches = await this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    const branchMap = new Map(branches.map((b) => [b.id, b.name]));

    const stockValue = await this.prisma.product.aggregate({
      where: { status: 'IN_STOCK', deletedAt: null, ...branchFilter },
      _sum: { costPrice: true },
      _count: true,
    });

    return {
      byStatusAndBranch: products.map((p) => ({
        status: p.status,
        branch: branchMap.get(p.branchId) || p.branchId,
        count: p._count,
      })),
      totalInStock: stockValue._count || 0,
      totalStockValue: Number(stockValue._sum.costPrice || 0),
    };
  }

  /**
   * Export data as CSV-ready format
   */
  async exportContracts(filters: { status?: string; branchId?: string; startDate?: string; endDate?: string }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        (where.createdAt as Record<string, unknown>).lte = end;
      }
    }

    const contracts = await this.prisma.contract.findMany({
      where,
      include: {
        customer: { select: { name: true, phone: true } },
        product: { select: { name: true, brand: true, model: true, imeiSerial: true } },
        branch: { select: { name: true } },
        salesperson: { select: { name: true } },
        payments: { select: { installmentNo: true, amountDue: true, amountPaid: true, status: true, dueDate: true, paidDate: true, lateFee: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return contracts.map((c) => ({
      contractNumber: c.contractNumber,
      status: c.status,
      customerName: c.customer.name,
      customerPhone: c.customer.phone,
      productName: `${c.product.brand} ${c.product.model}`,
      imei: c.product.imeiSerial,
      branch: c.branch.name,
      salesperson: c.salesperson.name,
      sellingPrice: Number(c.sellingPrice),
      downPayment: Number(c.downPayment),
      interestRate: Number(c.interestRate),
      totalMonths: c.totalMonths,
      monthlyPayment: Number(c.monthlyPayment),
      financedAmount: Number(c.financedAmount),
      interestTotal: Number(c.interestTotal),
      paidInstallments: c.payments.filter((p) => p.status === 'PAID').length,
      totalPaid: c.payments.reduce((s, p) => s + Number(p.amountPaid), 0),
      totalLateFees: c.payments.reduce((s, p) => s + Number(p.lateFee), 0),
      createdAt: c.createdAt,
    }));
  }
}
