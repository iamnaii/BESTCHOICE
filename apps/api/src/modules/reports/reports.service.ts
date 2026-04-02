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

  /**
   * Profit & Loss Report (งบกำไรขาดทุน ผังบัญชีไทย)
   */
  async getProfitLossReport(startDate: string, endDate: string, branchId?: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const branchFilter = branchId ? { branchId } : {};
    const dateRange = { gte: start, lte: end };

    // ═══ Revenue queries ═══
    const [
      cashSalesAgg,
      installmentSales,
      externalFinanceSales,
      paidPayments,
      financeReceived,
      expensesByCategory,
      productCosts,
    ] = await Promise.all([
      // Cash sales
      this.prisma.sale.aggregate({
        where: { saleType: 'CASH', createdAt: dateRange, ...branchFilter },
        _sum: { netAmount: true },
      }),
      // Installment sales (down payments + paid installments)
      this.prisma.sale.aggregate({
        where: { saleType: 'INSTALLMENT', createdAt: dateRange, ...branchFilter },
        _sum: { downPaymentAmount: true },
      }),
      // External finance sales (down payments)
      this.prisma.sale.aggregate({
        where: { saleType: 'EXTERNAL_FINANCE', createdAt: dateRange, ...branchFilter },
        _sum: { downPaymentAmount: true },
      }),
      // Payments received in period (installment payments + interest + late fees)
      this.prisma.payment.findMany({
        where: {
          paidDate: dateRange,
          status: 'PAID',
          contract: { deletedAt: null, ...branchFilter },
        },
        select: {
          amountPaid: true,
          lateFee: true,
          lateFeeWaived: true,
          contract: { select: { interestTotal: true, totalMonths: true } },
        },
      }),
      // Finance received
      this.prisma.financeReceivable.aggregate({
        where: {
          status: 'RECEIVED',
          receivedDate: dateRange,
          ...branchFilter,
        },
        _sum: { receivedAmount: true },
      }),
      // Expenses by category (only PAID or APPROVED, not VOIDED/REJECTED)
      this.prisma.expense.findMany({
        where: {
          expenseDate: dateRange,
          status: { in: ['PAID', 'APPROVED'] },
          deletedAt: null,
          ...branchFilter,
        },
        select: { category: true, totalAmount: true },
      }),
      // Product cost (COGS from sold products in period)
      this.prisma.sale.findMany({
        where: { createdAt: dateRange, ...branchFilter },
        select: {
          product: { select: { costPrice: true } },
        },
      }),
    ]);

    // ═══ Calculate revenue ═══
    const cashSales = Number(cashSalesAgg._sum.netAmount || 0);
    const installmentDownPayments = Number(installmentSales._sum.downPaymentAmount || 0);
    const financeDownPayments = Number(externalFinanceSales._sum.downPaymentAmount || 0);
    const financeReceivedAmount = Number(financeReceived._sum.receivedAmount || 0);

    let installmentPayments = 0;
    let interestIncome = 0;
    let lateFeeIncome = 0;
    for (const p of paidPayments) {
      installmentPayments += Number(p.amountPaid);
      interestIncome += Number(p.contract.interestTotal) / p.contract.totalMonths;
      if (!p.lateFeeWaived) lateFeeIncome += Number(p.lateFee);
    }

    const totalRevenue = cashSales + installmentDownPayments + installmentPayments
      + lateFeeIncome + financeDownPayments + financeReceivedAmount;

    // ═══ Calculate expenses by category ═══
    const expMap: Record<string, number> = {};
    for (const e of expensesByCategory) {
      expMap[e.category] = (expMap[e.category] || 0) + Number(e.totalAmount);
    }

    // COGS from product cost prices
    const purchaseOrderCost = productCosts.reduce((sum, s) => sum + Number(s.product.costPrice || 0), 0);

    // Cost of Sales (5100)
    const costOfSales = {
      cogsProduct: expMap['COGS_PRODUCT'] || 0,
      cogsRepairParts: expMap['COGS_REPAIR_PARTS'] || 0,
      purchaseOrderCost,
      totalCOGS: (expMap['COGS_PRODUCT'] || 0) + (expMap['COGS_REPAIR_PARTS'] || 0) + purchaseOrderCost,
    };

    const grossProfit = totalRevenue - costOfSales.totalCOGS;

    // Selling Expenses (5200)
    const sellingExpenses = {
      commission: expMap['SELL_COMMISSION'] || 0,
      advertising: expMap['SELL_ADVERTISING'] || 0,
      transport: expMap['SELL_TRANSPORT'] || 0,
      packaging: expMap['SELL_PACKAGING'] || 0,
      totalSelling: (expMap['SELL_COMMISSION'] || 0) + (expMap['SELL_ADVERTISING'] || 0)
        + (expMap['SELL_TRANSPORT'] || 0) + (expMap['SELL_PACKAGING'] || 0),
    };

    // Admin Expenses (5300)
    const adminExpenses = {
      salary: expMap['ADMIN_SALARY'] || 0,
      socialSecurity: expMap['ADMIN_SOCIAL_SECURITY'] || 0,
      rent: expMap['ADMIN_RENT'] || 0,
      utilities: expMap['ADMIN_UTILITIES'] || 0,
      officeSupplies: expMap['ADMIN_OFFICE_SUPPLIES'] || 0,
      depreciation: expMap['ADMIN_DEPRECIATION'] || 0,
      insurance: expMap['ADMIN_INSURANCE'] || 0,
      taxFee: expMap['ADMIN_TAX_FEE'] || 0,
      maintenance: expMap['ADMIN_MAINTENANCE'] || 0,
      travel: expMap['ADMIN_TRAVEL'] || 0,
      telephone: expMap['ADMIN_TELEPHONE'] || 0,
      totalAdmin: 0,
    };
    adminExpenses.totalAdmin = adminExpenses.salary + adminExpenses.socialSecurity
      + adminExpenses.rent + adminExpenses.utilities + adminExpenses.officeSupplies
      + adminExpenses.depreciation + adminExpenses.insurance + adminExpenses.taxFee
      + adminExpenses.maintenance + adminExpenses.travel + adminExpenses.telephone;

    const operatingProfit = grossProfit - sellingExpenses.totalSelling - adminExpenses.totalAdmin;

    // Other Expenses (5900)
    const otherExpenses = {
      interest: expMap['OTHER_INTEREST'] || 0,
      loss: expMap['OTHER_LOSS'] || 0,
      fine: expMap['OTHER_FINE'] || 0,
      misc: expMap['OTHER_MISC'] || 0,
      totalOther: (expMap['OTHER_INTEREST'] || 0) + (expMap['OTHER_LOSS'] || 0)
        + (expMap['OTHER_FINE'] || 0) + (expMap['OTHER_MISC'] || 0),
    };

    const netProfit = operatingProfit - otherExpenses.totalOther;
    const totalExpenses = costOfSales.totalCOGS + sellingExpenses.totalSelling
      + adminExpenses.totalAdmin + otherExpenses.totalOther;

    return {
      period: { start: startDate, end: endDate },
      revenue: {
        cashSales,
        installmentDownPayments,
        installmentPayments,
        interestIncome: Math.round(interestIncome),
        lateFeeIncome,
        financeDownPayments,
        financeReceived: financeReceivedAmount,
        totalRevenue,
      },
      costOfSales,
      grossProfit,
      sellingExpenses,
      adminExpenses,
      operatingProfit,
      otherExpenses,
      netProfit,
      summary: {
        totalRevenue,
        totalExpenses,
        netProfit,
        profitMargin: totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 10000) / 100 : 0,
      },
    };
  }

  /**
   * Monthly P&L Summary (12 months for a given year)
   * Optimized: 7 queries for full year, then group by month in JS
   */
  async getMonthlyPLSummary(year: number, branchId?: string) {
    const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
    const branchFilter = branchId ? { branchId } : {};
    const dateRange = { gte: yearStart, lte: yearEnd };

    const getMonth = (d: Date | string | null) => d ? new Date(d).getMonth() : -1;

    // 7 queries for full year (instead of 84)
    const [sales, payments, financeRecs, expenses, productSales] = await Promise.all([
      this.prisma.sale.findMany({
        where: { createdAt: dateRange, ...branchFilter },
        select: { saleType: true, netAmount: true, downPaymentAmount: true, createdAt: true },
      }),
      this.prisma.payment.findMany({
        where: { paidDate: dateRange, status: 'PAID', contract: { deletedAt: null, ...branchFilter } },
        select: { amountPaid: true, lateFee: true, lateFeeWaived: true, paidDate: true,
          contract: { select: { interestTotal: true, totalMonths: true } } },
      }),
      this.prisma.financeReceivable.findMany({
        where: { status: 'RECEIVED', receivedDate: dateRange, deletedAt: null, ...branchFilter },
        select: { receivedAmount: true, receivedDate: true },
      }),
      this.prisma.expense.findMany({
        where: { expenseDate: dateRange, status: { in: ['PAID', 'APPROVED'] }, deletedAt: null, ...branchFilter },
        select: { totalAmount: true, expenseDate: true },
      }),
      this.prisma.sale.findMany({
        where: { createdAt: dateRange, ...branchFilter },
        select: { createdAt: true, product: { select: { costPrice: true } } },
      }),
    ]);

    // Build monthly buckets
    const months = Array.from({ length: 12 }, (_, i) => {
      let revenue = 0;
      let cogs = 0;
      let expenseTotal = 0;

      // Revenue from sales
      for (const s of sales) {
        if (getMonth(s.createdAt) !== i) continue;
        if (s.saleType === 'CASH') revenue += Number(s.netAmount);
        if (s.saleType === 'INSTALLMENT' || s.saleType === 'EXTERNAL_FINANCE') {
          revenue += Number(s.downPaymentAmount || 0);
        }
      }

      // Revenue from payments (installments + interest + late fees)
      for (const p of payments) {
        if (getMonth(p.paidDate) !== i) continue;
        revenue += Number(p.amountPaid);
        if (!p.lateFeeWaived) revenue += Number(p.lateFee);
      }

      // Revenue from finance received
      for (const f of financeRecs) {
        if (getMonth(f.receivedDate) !== i) continue;
        revenue += Number(f.receivedAmount || 0);
      }

      // COGS from product cost prices
      for (const s of productSales) {
        if (getMonth(s.createdAt) !== i) continue;
        cogs += Number(s.product.costPrice || 0);
      }

      // Expenses
      for (const e of expenses) {
        if (getMonth(e.expenseDate) !== i) continue;
        expenseTotal += Number(e.totalAmount);
      }

      const totalExpenses = cogs + expenseTotal;
      const netProfit = revenue - totalExpenses;

      return { month: i + 1, label: thaiMonths[i], revenue, expenses: totalExpenses, netProfit };
    });

    return { year, months };
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
}
