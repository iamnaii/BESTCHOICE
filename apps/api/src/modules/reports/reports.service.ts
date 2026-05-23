import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, ContractStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { calculateDaysOverdue, calculateDaysElapsed } from '../../utils/date.util';

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private accounting: AccountingService,
  ) {}

  /**
   * Resolve companyId + branchId → effective branch ID list for report filtering.
   * Returns:
   * - [branchId]   — specific branch requested
   * - string[]     — all branches under the given company (SHOP multi-branch)
   * - []           — company exists but has no branches (FINANCE) → callers should return empty data
   * - undefined    — no filter at all (all branches across all companies)
   */
  async resolveCompanyBranches(companyId?: string, branchId?: string): Promise<string[] | undefined> {
    if (branchId) return [branchId]; // specific branch requested
    if (!companyId) return undefined; // no filter = all branches
    const branches = await this.prisma.branch.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true },
    });
    // FINANCE has no branches → empty array signals "no data for this company"
    return branches.map((b) => b.id);
  }

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
      const days = calculateDaysElapsed(p.dueDate, now);
      if (days <= 30) buckets['1-30'].push(p);
      else if (days <= 60) buckets['31-60'].push(p);
      else if (days <= 90) buckets['61-90'].push(p);
      else buckets['90+'].push(p);
    }

    const summarize = (items: typeof overduePayments) => ({
      count: items.length,
      totalOutstanding: items.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.amountDue ?? 0)).sub(new Prisma.Decimal(p.amountPaid ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber(),
      totalLateFees: items.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.lateFee ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber(),
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
      // C-7 fix: filter status=PAID and lateFeeWaived=false for accurate aggregation
      this.prisma.payment.aggregate({
        where: {
          paidDate: { gte: start, lte: end },
          status: 'PAID',
          lateFeeWaived: false,
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
      const monthlyInterest = new Prisma.Decimal(p.contract.interestTotal ?? 0)
        .div(p.contract.totalMonths);
      return sum.add(monthlyInterest);
    }, new Prisma.Decimal(0));

    return {
      period: { start: startDate, end: endDate },
      revenue: {
        interestIncome: Math.round(interestIncome.toNumber()),
        lateFeeIncome: new Prisma.Decimal(lateFeeIncome._sum.lateFee ?? 0).toNumber(),
        totalPaymentsReceived: new Prisma.Decimal(totalPayments._sum.amountPaid ?? 0).toNumber(),
        paymentCount: totalPayments._count || 0,
      },
      contracts: { newContracts },
    };
  }

  // P&L calculation delegated to AccountingService
  getProfitLossReport(startDate: string, endDate: string, branchId?: string, branchIds?: string[]) {
    return this.accounting.getProfitLossReport(startDate, endDate, branchId, branchIds);
  }

  getMonthlyPLSummary(year: number, branchId?: string, branchIds?: string[]) {
    return this.accounting.getMonthlyPLSummary(year, branchId, branchIds);
  }

  getComparativePL(year: number, month: number, branchId?: string, branchIds?: string[]) {
    return this.accounting.getComparativePL(year, month, branchId, branchIds);
  }

  // Balance Sheet & Cash Flow delegated to AccountingService
  getBalanceSheet(asOfDate: string, branchId?: string, branchIds?: string[]) {
    return this.accounting.getBalanceSheet(asOfDate, branchId, branchIds);
  }

  getCashFlowStatement(startDate: string, endDate: string, branchId?: string, branchIds?: string[]) {
    return this.accounting.getCashFlowStatement(startDate, endDate, branchId, branchIds);
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
          customer: { select: { id: true, name: true, phone: true, lineIdFinance: true, lineIdShop: true } },
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
        (sum, p) => sum
          .add(new Prisma.Decimal(p.amountDue ?? 0))
          .sub(new Prisma.Decimal(p.amountPaid ?? 0))
          .add(new Prisma.Decimal(p.lateFee ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber();
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
        daysOverdue: calculateDaysOverdue(oldestDue),
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
      existing.totalSales = new Prisma.Decimal(existing.totalSales)
        .add(new Prisma.Decimal(c.sellingPrice ?? 0)).toNumber();
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

    const branchIds = branches.map((b) => b.id);

    // Batch: one query per metric for all branches (5 queries total instead of 5 * N)
    const [newByBranch, activeByBranch, overdueByBranch, paymentsByBranch, productsByBranch] = await Promise.all([
      this.prisma.contract.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, createdAt: { gte: start, lte: end }, deletedAt: null },
        _count: true,
      }),
      this.prisma.contract.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, status: 'ACTIVE', deletedAt: null },
        _count: true,
      }),
      this.prisma.contract.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['contractId'],
        where: { paidDate: { gte: start, lte: end }, status: 'PAID', contract: { branchId: { in: branchIds } } },
        _sum: { amountPaid: true },
      }).then(async (groups) => {
        // We need branchId from the contract, so fetch a lightweight mapping
        if (groups.length === 0) return new Map<string, number>();
        const contractIds = groups.map((g) => g.contractId);
        const contracts = await this.prisma.contract.findMany({
          where: { id: { in: contractIds } },
          select: { id: true, branchId: true },
        });
        const contractBranchMap = new Map(contracts.map((c) => [c.id, c.branchId]));
        const result = new Map<string, number>();
        for (const g of groups) {
          const bid = contractBranchMap.get(g.contractId);
          if (bid) result.set(
            bid,
            new Prisma.Decimal(result.get(bid) ?? 0)
              .add(new Prisma.Decimal(g._sum.amountPaid ?? 0))
              .toNumber(),
          );
        }
        return result;
      }),
      this.prisma.product.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, status: 'IN_STOCK', deletedAt: null },
        _count: true,
      }),
    ]);

    // Build lookup maps
    const newMap = new Map(newByBranch.map((g) => [g.branchId, g._count]));
    const activeMap = new Map(activeByBranch.map((g) => [g.branchId, g._count]));
    const overdueMap = new Map(overdueByBranch.map((g) => [g.branchId, g._count]));
    const productsMap = new Map(productsByBranch.map((g) => [g.branchId, g._count]));

    return branches.map((branch) => ({
      branchId: branch.id,
      branchName: branch.name,
      newContracts: newMap.get(branch.id) || 0,
      activeContracts: activeMap.get(branch.id) || 0,
      overdueContracts: overdueMap.get(branch.id) || 0,
      paymentsReceived: paymentsByBranch.get(branch.id) || 0,
      inStockProducts: productsMap.get(branch.id) || 0,
    }));
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
      byMethod[method].total = new Prisma.Decimal(byMethod[method].total)
        .add(new Prisma.Decimal(p.amountPaid ?? 0)).toNumber();

      const branch = p.contract.branch.name;
      if (!byBranch[branch]) byBranch[branch] = { count: 0, total: 0 };
      byBranch[branch].count++;
      byBranch[branch].total = new Prisma.Decimal(byBranch[branch].total)
        .add(new Prisma.Decimal(p.amountPaid ?? 0)).toNumber();
    }

    return {
      date,
      totalPayments: total,
      totalAmount: Math.round(new Prisma.Decimal(aggregation._sum.amountPaid ?? 0).toNumber()),
      byMethod,
      byBranch,
      data: payments.map((p) => ({
        id: p.id,
        contractNumber: p.contract.contractNumber,
        customer: p.contract.customer.name,
        branch: p.contract.branch.name,
        installmentNo: p.installmentNo,
        amountPaid: new Prisma.Decimal(p.amountPaid ?? 0).toNumber(),
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
      totalStockValue: new Prisma.Decimal(stockValue._sum.costPrice ?? 0).toNumber(),
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
      sellingPrice: new Prisma.Decimal(c.sellingPrice ?? 0).toNumber(),
      downPayment: new Prisma.Decimal(c.downPayment ?? 0).toNumber(),
      interestRate: new Prisma.Decimal(c.interestRate ?? 0).toNumber(),
      totalMonths: c.totalMonths,
      monthlyPayment: new Prisma.Decimal(c.monthlyPayment ?? 0).toNumber(),
      financedAmount: new Prisma.Decimal(c.financedAmount ?? 0).toNumber(),
      interestTotal: new Prisma.Decimal(c.interestTotal ?? 0).toNumber(),
      paidInstallments: c.payments.filter((p) => p.status === 'PAID').length,
      totalPaid: c.payments.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.amountPaid ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber(),
      totalLateFees: c.payments.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.lateFee ?? 0)),
        new Prisma.Decimal(0),
      ).toNumber(),
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
    const totalLateFees = new Prisma.Decimal(lateFeeAgg._sum.lateFee ?? 0).toNumber();

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
      const shopProfit = new Prisma.Decimal(t.shopProfit ?? 0).toNumber();
      const financeProfit = new Prisma.Decimal(t.financeProfit ?? 0).toNumber();
      const commission = new Prisma.Decimal(t.commission ?? 0).toNumber();
      const interestTotal = new Prisma.Decimal(t.interestTotal ?? 0).toNumber();
      const costPrice = new Prisma.Decimal(t.costPrice ?? 0).toNumber();
      const principal = new Prisma.Decimal(t.principal ?? 0).toNumber();
      const downPayment = new Prisma.Decimal(t.downPayment ?? 0).toNumber();
      const sellingPrice = new Prisma.Decimal(t.sellingPrice ?? 0).toNumber();

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
        totalVat: transactions.reduce(
          (s, t) => s.add(new Prisma.Decimal(t.vatAmount ?? 0)),
          new Prisma.Decimal(0),
        ).toNumber(),
      },
      details,
    };
  }

  /**
   * FINANCE Portfolio: all contracts owned by BESTCHOICE FINANCE
   * Returns per-contract receivable calculations + portfolio summary + aging.
   */
  async getFinancePortfolio(
    status?: string,
    page = 1,
    limit = 50,
    startDate?: string,
    endDate?: string,
  ) {
    const safeLimit = Math.min(limit, 100);

    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    if (!financeCompany) {
      return {
        data: [],
        summary: { totalContracts: 0, totalReceivable: 0, totalCollected: 0, totalOutstanding: 0, collectionRate: 0 },
        aging: {
          current: { count: 0, amount: 0 },
          days1to30: { count: 0, amount: 0 },
          days31to60: { count: 0, amount: 0 },
          days61to90: { count: 0, amount: 0 },
          over90: { count: 0, amount: 0 },
        },
        total: 0,
        page,
        limit: safeLimit,
      };
    }

    const defaultStatuses = [
      ContractStatus.ACTIVE,
      ContractStatus.OVERDUE,
      ContractStatus.DEFAULT,
      ContractStatus.COMPLETED,
      ContractStatus.EARLY_PAYOFF,
      ContractStatus.EXCHANGED,
    ] as const;

    const statusFilter =
      status && status !== 'ALL' && Object.values(ContractStatus).includes(status as ContractStatus)
        ? [status as ContractStatus]
        : [...defaultStatuses];

    // Date range filters Contract.createdAt — empty string = no filter (open-ended)
    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      const d = new Date(`${startDate}T00:00:00`);
      if (!isNaN(d.getTime())) createdAtFilter.gte = d;
    }
    if (endDate) {
      const d = new Date(`${endDate}T23:59:59.999`);
      if (!isNaN(d.getTime())) createdAtFilter.lte = d;
    }

    const where = {
      deletedAt: null,
      status: { in: statusFilter },
      product: { ownedByCompanyId: financeCompany.id, deletedAt: null },
      ...(createdAtFilter.gte || createdAtFilter.lte ? { createdAt: createdAtFilter } : {}),
    };

    const [contracts, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          product: { select: { brand: true, model: true, imeiSerial: true } },
          branch: { select: { name: true } },
          payments: {
            where: { deletedAt: null },
            select: {
              id: true,
              installmentNo: true,
              amountDue: true,
              amountPaid: true,
              lateFee: true,
              dueDate: true,
              status: true,
            },
            orderBy: { installmentNo: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.contract.count({ where }),
    ]);

    const now = new Date();

    const data = contracts.map((c) => {
      const totalReceivable = c.payments.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.amountDue ?? 0)),
        new Prisma.Decimal(0),
      );
      const totalPaid = c.payments.reduce(
        (s, p) => s.add(new Prisma.Decimal(p.amountPaid ?? 0)),
        new Prisma.Decimal(0),
      );
      const outstanding = totalReceivable.sub(totalPaid);
      const paidInstallments = c.payments.filter((p) => p.status === 'PAID').length;
      const remainingInstallments = c.totalMonths - paidInstallments;

      const pendingPayments = c.payments
        .filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE' || p.status === 'PARTIALLY_PAID')
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      const nextDueDate = pendingPayments.length > 0 ? pendingPayments[0].dueDate : null;

      return {
        id: c.id,
        contractNumber: c.contractNumber,
        status: c.status,
        customer: c.customer,
        product: c.product,
        branch: c.branch.name,
        sellingPrice: new Prisma.Decimal(c.sellingPrice ?? 0).toNumber(),
        financedAmount: new Prisma.Decimal(c.financedAmount ?? 0).toNumber(),
        monthlyPayment: new Prisma.Decimal(c.monthlyPayment ?? 0).toNumber(),
        totalMonths: c.totalMonths,
        paidInstallments,
        remainingInstallments,
        totalReceivable: totalReceivable.toNumber(),
        totalPaid: totalPaid.toNumber(),
        outstanding: outstanding.toNumber(),
        nextDueDate,
        createdAt: c.createdAt,
      };
    });

    // Summary and aging computed over ALL matching contracts (not just current page)
    const allContracts = await this.prisma.contract.findMany({
      where,
      include: {
        payments: {
          where: { deletedAt: null },
          select: { amountDue: true, amountPaid: true, dueDate: true, status: true },
        },
      },
    });

    let sumReceivable = new Prisma.Decimal(0);
    let sumCollected = new Prisma.Decimal(0);

    const aging = {
      current: { count: 0, amount: new Prisma.Decimal(0) },
      days1to30: { count: 0, amount: new Prisma.Decimal(0) },
      days31to60: { count: 0, amount: new Prisma.Decimal(0) },
      days61to90: { count: 0, amount: new Prisma.Decimal(0) },
      over90: { count: 0, amount: new Prisma.Decimal(0) },
    };

    for (const c of allContracts) {
      for (const p of c.payments) {
        const due = new Prisma.Decimal(p.amountDue ?? 0);
        const paid = new Prisma.Decimal(p.amountPaid ?? 0);
        sumReceivable = sumReceivable.add(due);
        sumCollected = sumCollected.add(paid);
        const pOutstanding = due.sub(paid);

        if (p.status === 'PAID') continue;

        const dueDate = new Date(p.dueDate);
        const diffDays = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays <= 0) {
          aging.current.count++;
          aging.current.amount = aging.current.amount.add(pOutstanding);
        } else if (diffDays <= 30) {
          aging.days1to30.count++;
          aging.days1to30.amount = aging.days1to30.amount.add(pOutstanding);
        } else if (diffDays <= 60) {
          aging.days31to60.count++;
          aging.days31to60.amount = aging.days31to60.amount.add(pOutstanding);
        } else if (diffDays <= 90) {
          aging.days61to90.count++;
          aging.days61to90.amount = aging.days61to90.amount.add(pOutstanding);
        } else {
          aging.over90.count++;
          aging.over90.amount = aging.over90.amount.add(pOutstanding);
        }
      }
    }

    const sumReceivableNum = sumReceivable.toNumber();
    const sumCollectedNum = sumCollected.toNumber();

    return {
      data,
      summary: {
        totalContracts: allContracts.length,
        totalReceivable: sumReceivableNum,
        totalCollected: sumCollectedNum,
        totalOutstanding: new Prisma.Decimal(sumReceivableNum).sub(new Prisma.Decimal(sumCollectedNum)).toNumber(),
        collectionRate: sumReceivableNum > 0
          ? Math.round((sumCollectedNum / sumReceivableNum) * 10000) / 100
          : 0,
      },
      aging: {
        current: { count: aging.current.count, amount: aging.current.amount.toNumber() },
        days1to30: { count: aging.days1to30.count, amount: aging.days1to30.amount.toNumber() },
        days31to60: { count: aging.days31to60.count, amount: aging.days31to60.amount.toNumber() },
        days61to90: { count: aging.days61to90.count, amount: aging.days61to90.amount.toNumber() },
        over90: { count: aging.over90.count, amount: aging.over90.amount.toNumber() },
      },
      total,
      page,
      limit: safeLimit,
    };
  }

  /**
   * R-015: Quarterly P&L report aggregation
   * Calculates start/end dates for the given quarter and delegates to AccountingService.
   */
  async getQuarterlyReport(year: number, quarter: number, branchId?: string, branchIds?: string[]) {
    if (quarter < 1 || quarter > 4) {
      throw new BadRequestException('ไตรมาสต้องอยู่ระหว่าง 1-4');
    }
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const endDate = new Date(year, endMonth, 0).toISOString().split('T')[0];
    return this.accounting.getProfitLossReport(startDate, endDate, branchId, branchIds);
  }
}
