import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private accounting: AccountingService,
  ) {}

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
          contract: { deletedAt: null, ...branchFilter },
        },
        _sum: { lateFee: true, amountPaid: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          paidDate: { gte: start, lte: end },
          status: 'PAID',
          contract: { deletedAt: null, ...branchFilter },
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

  // P&L calculation delegated to AccountingService
  getProfitLossReport(startDate: string, endDate: string, branchId?: string) {
    return this.accounting.getProfitLossReport(startDate, endDate, branchId);
  }

  getMonthlyPLSummary(year: number, branchId?: string) {
    return this.accounting.getMonthlyPLSummary(year, branchId);
  }

  getComparativePL(year: number, month: number, branchId?: string) {
    return this.accounting.getComparativePL(year, month, branchId);
  }

  // Balance Sheet & Cash Flow delegated to AccountingService
  getBalanceSheet(asOfDate: string, branchId?: string) {
    return this.accounting.getBalanceSheet(asOfDate, branchId);
  }

  getCashFlowStatement(startDate: string, endDate: string, branchId?: string) {
    return this.accounting.getCashFlowStatement(startDate, endDate, branchId);
  }

  /**
   * High-risk customers report
   */
  async getHighRiskCustomers(branchId?: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const branchFilter = branchId ? { branchId } : {};
    const where = { status: { in: ['OVERDUE' as const, 'DEFAULT' as const] }, deletedAt: null, ...branchFilter };

    const [customers, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true, lineId: true } },
          branch: { select: { name: true } },
          payments: {
            where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] } },
            select: { amountDue: true, amountPaid: true, lateFee: true, dueDate: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.contract.count({ where }),
    ]);

    const data = customers.map((c) => {
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

    return { data, total, page, limit: safeLimit };
  }

  /**
   * Sales comparison by staff
   */
  async getSalesComparisonReport(startDate: string, endDate: string, branchId?: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
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

    const sorted = Array.from(staffMap.entries()).map(([id, data]) => ({
      salespersonId: id,
      ...data,
      overdueRate: data.totalContracts > 0 ? ((data.overdueCount / data.totalContracts) * 100).toFixed(1) : '0.0',
    })).sort((a, b) => b.totalSales - a.totalSales);

    const total = sorted.length;
    const data = sorted.slice((page - 1) * safeLimit, page * safeLimit);

    return { data, total, page, limit: safeLimit };
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
  async getDailyPaymentSummary(date: string, branchId?: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const start = new Date(date);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const branchFilter = branchId ? { contract: { branchId } } : {};

    const where = {
      paidDate: { gte: start, lt: end },
      status: 'PAID' as const,
      ...branchFilter,
    };

    const [payments, total, aggregation] = await Promise.all([
      this.prisma.payment.findMany({
        where,
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
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({
        where,
        _sum: { amountPaid: true },
      }),
    ]);

    // byMethod and byBranch are computed from the current page
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
      totalPayments: total,
      totalAmount: Math.round(Number(aggregation._sum.amountPaid || 0)),
      byMethod,
      byBranch,
      data: payments.map((p) => ({
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
      total,
      page,
      limit: safeLimit,
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
      take: 5000,
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

  /**
   * Entity Profit Report: BESTCHOICE SHOP vs BESTCHOICE FINANCE
   * Uses InterCompanyTransaction data to calculate profit per entity.
   */
  async getEntityProfitReport(startDate: string, endDate: string, branchId?: string, entity?: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const where: Record<string, unknown> = {
      deletedAt: null,
      createdAt: { gte: start, lte: end },
    };
    if (branchId) where.branchId = branchId;

    const transactions = await this.prisma.interCompanyTransaction.findMany({
      where,
      include: {
        sale: {
          select: { saleNumber: true, customer: { select: { name: true } } },
        },
        contract: { select: { contractNumber: true, status: true, totalMonths: true } },
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Aggregate late fees from contracts in this period (Finance revenue)
    const lateFeesWhere: Record<string, unknown> = {
      paidDate: { gte: start, lte: end },
      lateFee: { gt: 0 },
      contract: { deletedAt: null, ...(branchId ? { branchId } : {}) },
    };
    const lateFeeAgg = await this.prisma.payment.aggregate({
      where: lateFeesWhere,
      _sum: { lateFee: true },
    });
    const totalLateFees = Number(lateFeeAgg._sum.lateFee || 0);

    // Summaries
    const shop = {
      revenue: 0,
      costOfGoods: 0,
      commission: 0,
      profit: 0,
      transactionCount: 0,
    };
    const finance = {
      interestIncome: 0,
      commissionExpense: 0,
      lateFeeIncome: totalLateFees,
      profit: 0,
      transactionCount: 0,
    };

    const details: Array<{
      id: string;
      saleNumber: string;
      customerName: string;
      contractNumber: string | null;
      branchName: string;
      sellingPrice: number;
      costPrice: number;
      downPayment: number;
      principal: number;
      commission: number;
      interestTotal: number;
      shopProfit: number;
      financeProfit: number;
      createdAt: Date;
    }> = [];

    for (const t of transactions) {
      const shopProfit = Number(t.shopProfit);
      const financeProfit = Number(t.financeProfit);
      const commission = Number(t.commission);
      const interestTotal = Number(t.interestTotal);
      const costPrice = Number(t.costPrice);
      const principal = Number(t.principal);
      const downPayment = Number(t.downPayment);
      const sellingPrice = Number(t.sellingPrice);

      shop.revenue += downPayment + principal + commission;
      shop.costOfGoods += costPrice;
      shop.commission += commission;
      shop.profit += shopProfit;
      shop.transactionCount++;

      finance.interestIncome += interestTotal;
      finance.commissionExpense += commission;
      finance.profit += financeProfit;
      finance.transactionCount++;

      details.push({
        id: t.id,
        saleNumber: t.sale.saleNumber,
        customerName: t.sale.customer?.name || '-',
        contractNumber: t.contract?.contractNumber || null,
        branchName: t.branch.name,
        sellingPrice,
        costPrice,
        downPayment,
        principal,
        commission,
        interestTotal,
        shopProfit,
        financeProfit,
        createdAt: t.createdAt,
      });
    }

    // Add late fees to finance profit
    finance.profit += totalLateFees;

    // Filter by entity if specified
    if (entity === 'SHOP') {
      return { period: { start: startDate, end: endDate }, entity: 'BESTCHOICE SHOP', shop, details };
    }
    if (entity === 'FINANCE') {
      return { period: { start: startDate, end: endDate }, entity: 'BESTCHOICE FINANCE', finance, details };
    }

    return {
      period: { start: startDate, end: endDate },
      shop,
      finance,
      combined: {
        totalProfit: shop.profit + finance.profit,
        totalVat: transactions.reduce((s, t) => s + Number(t.vatAmount), 0),
      },
      details,
    };
  }

  /**
   * R-015: Quarterly P&L report aggregation
   * Calculates start/end dates for the given quarter and delegates to AccountingService.
   */
  async getQuarterlyReport(year: number, quarter: number, branchId?: string) {
    if (quarter < 1 || quarter > 4) {
      throw new BadRequestException('ไตรมาสต้องอยู่ระหว่าง 1-4');
    }
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const endDate = new Date(year, endMonth, 0).toISOString().split('T')[0];
    return this.accounting.getProfitLossReport(startDate, endDate, branchId);
  }
}
