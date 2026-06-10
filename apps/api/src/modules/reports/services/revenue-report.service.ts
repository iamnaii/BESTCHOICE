import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Revenue-domain read reports extracted from ReportsService.
 *
 * Plain class (NOT @Injectable / NOT DI-registered) — internally constructed by
 * the ReportsService facade so the facade's 2-arg ctor + every `new
 * ReportsService(...)` spec site stay untouched. Pure-read over prisma.
 */
export class RevenueReportService {
  constructor(private prisma: PrismaService) {}

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
}
