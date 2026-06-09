import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { EXPENSE_ACCOUNT_CATEGORY } from './accounting-section-map.util';

/**
 * Wave-4 P5: transactional (sales/payment-aggregate-based) financial reports
 * extracted from AccountingService. These are the estimate/derived reports —
 * distinct from the journal-line-based getProfitLossFromJournal / *FromJournal
 * family which remain in AccountingService. Behavior-preserving move; logic is
 * verbatim from the original AccountingService methods.
 */
@Injectable()
export class TransactionalReportService {
  private readonly logger = new Logger(TransactionalReportService.name);
  constructor(
    private prisma: PrismaService,
    private companyResolver: CompanyResolverService,
  ) {}

  /**
   * Aggregate POSTED FINANCE journal expense lines (51-54) for a period into
   * section totals (authoritative) + a curated category breakdown (display).
   * Only runs for company-wide views — per-branch expense attribution is
   * deferred until SHOP accounting exists (journal has no branchId).
   */
  private async aggregateFinanceExpenses(
    start: Date,
    end: Date,
    companyWide: boolean,
  ): Promise<{
    byCategory: { category: string; totalAmount: Prisma.Decimal }[];
    sectionTotals: { selling: Prisma.Decimal; admin: Prisma.Decimal; other: Prisma.Decimal };
  }> {
    const zero = () => new Prisma.Decimal(0);
    if (!companyWide) {
      return { byCategory: [], sectionTotals: { selling: zero(), admin: zero(), other: zero() } };
    }

    const financeCompanyId = await this.companyResolver.getFinanceCompanyId();
    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: start, lte: end },
          deletedAt: null,
          companyId: financeCompanyId,
        },
        deletedAt: null,
        OR: [
          { accountCode: { startsWith: '51-' } },
          { accountCode: { startsWith: '52-' } },
          { accountCode: { startsWith: '53-' } },
          { accountCode: { startsWith: '54-' } },
        ],
      },
      _sum: { debit: true, credit: true },
    });

    let selling = zero();
    let admin = zero();
    let other = zero();
    const byCategoryMap = new Map<string, Prisma.Decimal>();

    for (const row of lineSums) {
      const net = new Prisma.Decimal(row._sum.debit ?? 0).sub(new Prisma.Decimal(row._sum.credit ?? 0));
      const prefix = row.accountCode.slice(0, 2);
      if (prefix === '52') selling = selling.add(net);
      else if (prefix === '53') admin = admin.add(net);
      else if (prefix === '51' || prefix === '54') other = other.add(net);

      const category = EXPENSE_ACCOUNT_CATEGORY[row.accountCode];
      if (category) {
        byCategoryMap.set(category, (byCategoryMap.get(category) ?? zero()).add(net));
      }
    }

    return {
      byCategory: [...byCategoryMap.entries()].map(([category, totalAmount]) => ({ category, totalAmount })),
      sectionTotals: { selling, admin, other },
    };
  }

  // ─── P&L Calculation ─────────────────────────────────────────────────────────

  async getProfitLossReport(
    startDate: string,
    endDate: string,
    branchId?: string,
    branchIds?: string[],
    includeFinanceExpenses = false,
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const branchFilter =
      branchIds !== undefined
        ? { branchId: { in: branchIds } }
        : branchId
          ? { branchId }
          : {};
    const dateRange = { gte: start, lte: end };

    const [
      cashSalesAgg,
      installmentSales,
      externalFinanceSales,
      paidPayments,
      financeReceived,
      productCosts,
    ] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { saleType: 'CASH', createdAt: dateRange, deletedAt: null, ...branchFilter },
        _sum: { netAmount: true },
      }),
      this.prisma.sale.aggregate({
        where: { saleType: 'INSTALLMENT', createdAt: dateRange, deletedAt: null, ...branchFilter },
        _sum: { downPaymentAmount: true },
      }),
      this.prisma.sale.aggregate({
        where: { saleType: 'EXTERNAL_FINANCE', createdAt: dateRange, deletedAt: null, ...branchFilter },
        _sum: { downPaymentAmount: true },
      }),
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
          monthlyPrincipal: true,
          monthlyInterest: true,
          monthlyCommission: true,
          vatAmount: true,
          contract: { select: { interestTotal: true, totalMonths: true } },
        },
      }),
      this.prisma.financeReceivable.aggregate({
        where: { status: 'RECEIVED', receivedDate: dateRange, ...branchFilter },
        _sum: { receivedAmount: true },
      }),
      this.prisma.sale.findMany({
        where: { createdAt: dateRange, deletedAt: null, ...branchFilter },
        select: { product: { select: { costPrice: true } }, bundleProductIds: true },
      }),
    ]);

    // FINANCE 51-54 central expenses are added only when the CALLER explicitly asks
    // (includeFinanceExpenses). The caller — reports.service.shouldIncludeFinanceExpenses
    // (role + branchId + companyId) or monthly-close (closing company) — has the full
    // context; inferring it here from branchId alone was wrong (a single-branch filter
    // arrives as branchIds=[one], and a SHOP-company view would leak FINANCE expenses).
    // A single isolated branch and a SHOP-company view both pass false (separate work).
    const { byCategory: expensesByCategory, sectionTotals } =
      await this.aggregateFinanceExpenses(start, end, includeFinanceExpenses);

    const cashSales = new Prisma.Decimal(cashSalesAgg._sum.netAmount ?? 0);
    const installmentDownPayments = new Prisma.Decimal(installmentSales._sum.downPaymentAmount ?? 0);
    const financeDownPayments = new Prisma.Decimal(externalFinanceSales._sum.downPaymentAmount ?? 0);
    const financeReceivedAmount = new Prisma.Decimal(financeReceived._sum.receivedAmount ?? 0);

    // Payment breakdown: use stored breakdowns when available, fallback for legacy payments
    let installmentPaymentsTotal = new Prisma.Decimal(0); // ยอดรับชำระจากค่างวดรวม (amountPaid)
    let interestIncome = new Prisma.Decimal(0);           // ดอกเบี้ย (4210) — breakdown info
    let commissionIncome = new Prisma.Decimal(0);         // ค่าคอม (4400) — breakdown info
    let principalIncome = new Prisma.Decimal(0);          // เงินต้น — breakdown info
    let lateFeeIncome = new Prisma.Decimal(0);            // ค่าปรับ (4300)
    let vatCollected = new Prisma.Decimal(0);             // VAT ที่เก็บ (2210 - liability not revenue)

    for (const p of paidPayments) {
      const paid = new Prisma.Decimal(p.amountPaid);
      installmentPaymentsTotal = installmentPaymentsTotal.add(paid);

      if (p.monthlyPrincipal !== null) {
        // New: use stored breakdowns for detailed reporting
        principalIncome = principalIncome.add(new Prisma.Decimal(p.monthlyPrincipal));
        interestIncome = interestIncome.add(new Prisma.Decimal(p.monthlyInterest ?? 0));
        commissionIncome = commissionIncome.add(new Prisma.Decimal(p.monthlyCommission ?? 0));
        vatCollected = vatCollected.add(new Prisma.Decimal(p.vatAmount ?? 0));
      } else {
        // Legacy fallback: estimate interest from contract data
        principalIncome = principalIncome.add(paid);
        interestIncome = interestIncome.add(
          new Prisma.Decimal(p.contract.interestTotal).div(p.contract.totalMonths),
        );
      }
      if (!p.lateFeeWaived) lateFeeIncome = lateFeeIncome.add(new Prisma.Decimal(p.lateFee));
    }

    // installmentPayments = total amountPaid from installment contracts (includes principal+interest+commission+VAT)
    // Interest/commission/VAT breakdowns are informational, NOT additive on top of installmentPayments
    const installmentPayments = installmentPaymentsTotal;

    const operatingRevenue = cashSales.add(installmentDownPayments).add(installmentPayments)
      .add(financeDownPayments).add(financeReceivedAmount);
    // Late fee income is additive (it's separate from amountPaid — stored in lateFee field)
    const totalRevenue = operatingRevenue.add(lateFeeIncome);

    const expMap: Record<string, Prisma.Decimal> = {};
    for (const e of expensesByCategory) {
      expMap[e.category] = (expMap[e.category] ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(e.totalAmount));
    }

    const getExp = (key: string) => expMap[key] ?? new Prisma.Decimal(0);

    // COGS: main product cost + bundle product costs
    const allBundleIds = productCosts.flatMap((s) => s.bundleProductIds || []);
    let bundleCost = new Prisma.Decimal(0);
    if (allBundleIds.length > 0) {
      const bundleProducts = await this.prisma.product.findMany({
        where: { id: { in: allBundleIds } },
        select: { costPrice: true },
      });
      // WR-010: Consistency check — warn if some bundle products were not found (deleted/missing)
      if (bundleProducts.length !== allBundleIds.length) {
        this.logger.warn(
          `COGS bundle mismatch: expected ${allBundleIds.length} products, found ${bundleProducts.length}`,
        );
      }
      bundleCost = bundleProducts.reduce(
        (sum, p) => sum.add(new Prisma.Decimal(p.costPrice ?? 0)),
        new Prisma.Decimal(0),
      );
    }
    const purchaseOrderCost = productCosts
      .reduce(
        (sum, s) => sum.add(new Prisma.Decimal(s.product.costPrice ?? 0)),
        new Prisma.Decimal(0),
      )
      .add(bundleCost);

    const cogsProduct = getExp('COGS_PRODUCT');
    const cogsRepairParts = getExp('COGS_REPAIR_PARTS');
    const totalCOGS = cogsProduct.add(cogsRepairParts).add(purchaseOrderCost);

    const costOfSales = {
      cogsProduct: cogsProduct.toNumber(),
      cogsRepairParts: cogsRepairParts.toNumber(),
      purchaseOrderCost: purchaseOrderCost.toNumber(),
      totalCOGS: totalCOGS.toNumber(),
    };

    // Gross profit from operating revenue only (excludes interest/late fees)
    const grossProfit = operatingRevenue.sub(totalCOGS);

    const sellCommission = getExp('SELL_COMMISSION');
    const sellAdvertising = getExp('SELL_ADVERTISING');
    const sellTransport = getExp('SELL_TRANSPORT');
    const sellPackaging = getExp('SELL_PACKAGING');
    // Total from the journal section sum (52) — authoritative; granular SELL_* lines above are best-effort display.
    const totalSelling = sectionTotals.selling;

    const sellingExpenses = {
      commission: sellCommission.toNumber(),
      advertising: sellAdvertising.toNumber(),
      transport: sellTransport.toNumber(),
      packaging: sellPackaging.toNumber(),
      totalSelling: totalSelling.toNumber(),
    };

    const adminSalary = getExp('ADMIN_SALARY');
    const adminSocialSecurity = getExp('ADMIN_SOCIAL_SECURITY');
    const adminRent = getExp('ADMIN_RENT');
    const adminUtilities = getExp('ADMIN_UTILITIES');
    const adminOfficeSupplies = getExp('ADMIN_OFFICE_SUPPLIES');
    const adminDepreciation = getExp('ADMIN_DEPRECIATION');
    const adminInsurance = getExp('ADMIN_INSURANCE');
    const adminTaxFee = getExp('ADMIN_TAX_FEE');
    const adminMaintenance = getExp('ADMIN_MAINTENANCE');
    const adminTravel = getExp('ADMIN_TRAVEL');
    const adminTelephone = getExp('ADMIN_TELEPHONE');
    // Total from the journal section sum (53) — authoritative; granular ADMIN_* lines above are best-effort display.
    const totalAdmin = sectionTotals.admin;

    const adminExpenses = {
      salary: adminSalary.toNumber(),
      socialSecurity: adminSocialSecurity.toNumber(),
      rent: adminRent.toNumber(),
      utilities: adminUtilities.toNumber(),
      officeSupplies: adminOfficeSupplies.toNumber(),
      depreciation: adminDepreciation.toNumber(),
      insurance: adminInsurance.toNumber(),
      taxFee: adminTaxFee.toNumber(),
      maintenance: adminMaintenance.toNumber(),
      travel: adminTravel.toNumber(),
      telephone: adminTelephone.toNumber(),
      totalAdmin: totalAdmin.toNumber(),
    };

    // C-1 fix: TAS 1 structure — operatingProfit excludes other income/expenses
    const operatingProfit = grossProfit.sub(totalSelling).sub(totalAdmin);

    const otherInterest = getExp('OTHER_INTEREST');
    const otherLoss = getExp('OTHER_LOSS');
    const otherFine = getExp('OTHER_FINE');
    const otherMisc = getExp('OTHER_MISC');
    // Total from the journal section sums (51 + 54) — authoritative; granular OTHER_* lines above are best-effort display.
    const totalOther = sectionTotals.other;

    const otherExpenses = {
      interest: otherInterest.toNumber(),
      loss: otherLoss.toNumber(),
      fine: otherFine.toNumber(),
      misc: otherMisc.toNumber(),
      totalOther: totalOther.toNumber(),
    };

    // C-1 fix: netProfit = operatingProfit + lateFeeIncome - otherExpenses (TAS 1)
    // Interest/commission/VAT are already inside installmentPayments (amountPaid).
    // Only lateFee is truly additive (stored separately in lateFee field).
    const netProfit = operatingProfit.add(lateFeeIncome).sub(totalOther);
    const totalExpenses = totalCOGS.add(totalSelling).add(totalAdmin).add(totalOther);

    const totalRevenueNum = totalRevenue.toNumber();
    const netProfitNum = netProfit.toNumber();

    return {
      period: { start: startDate, end: endDate },
      revenue: {
        cashSales: cashSales.toNumber(),
        installmentDownPayments: installmentDownPayments.toNumber(),
        installmentPayments: installmentPayments.toNumber(),
        financeDownPayments: financeDownPayments.toNumber(),
        financeReceived: financeReceivedAmount.toNumber(),
        operatingRevenue: operatingRevenue.toNumber(),
        lateFeeIncome: lateFeeIncome.toNumber(),
        totalRevenue: totalRevenueNum,
      },
      // Breakdown of installmentPayments (informational — already included in installmentPayments)
      paymentBreakdown: {
        principalIncome: principalIncome.toNumber(),
        interestIncome: interestIncome.toNumber(),
        commissionIncome: commissionIncome.toNumber(),
        note: 'เงินต้น/ดอกเบี้ย/ค่าคอม รวมอยู่ใน installmentPayments แล้ว — แสดงเพื่อแยกรายได้ตามหมวดบัญชี',
      },
      vatOutput: {
        accountCode: '21-2101',
        label: 'ภาษีขาย (Output VAT)',
        amount: vatCollected.toNumber(),
        note: 'เก็บจากค่างวดผ่อนชำระ — เป็นหนี้สินไม่ใช่รายได้',
      },
      costOfSales,
      grossProfit: grossProfit.toNumber(),
      sellingExpenses,
      adminExpenses,
      operatingProfit: operatingProfit.toNumber(),
      otherExpenses,
      netProfit: netProfitNum,
      expenseBasis: 'accrual-journal' as const,
      summary: {
        totalRevenue: totalRevenueNum,
        totalExpenses: totalExpenses.toNumber(),
        netProfit: netProfitNum,
        profitMargin: totalRevenueNum > 0 ? Math.round((netProfitNum / totalRevenueNum) * 10000) / 100 : 0,
      },
    };
  }

  async getMonthlyPLSummary(
    year: number,
    branchId?: string,
    branchIds?: string[],
    includeFinanceExpenses = false,
  ) {
    const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
    const branchFilter =
      branchIds !== undefined
        ? { branchId: { in: branchIds } }
        : branchId
          ? { branchId }
          : {};
    const dateRange = { gte: yearStart, lte: yearEnd };

    const getMonth = (d: Date | string | null) => (d ? new Date(d).getMonth() : -1);

    const [sales, payments, financeRecs, productSales] = await Promise.all([
      this.prisma.sale.findMany({
        where: { createdAt: dateRange, ...branchFilter },
        select: { saleType: true, netAmount: true, downPaymentAmount: true, createdAt: true },
      }),
      this.prisma.payment.findMany({
        where: { paidDate: dateRange, status: 'PAID', contract: { deletedAt: null, ...branchFilter } },
        select: {
          amountPaid: true, lateFee: true, lateFeeWaived: true, paidDate: true,
          monthlyPrincipal: true, monthlyInterest: true, monthlyCommission: true, vatAmount: true,
          contract: { select: { interestTotal: true, totalMonths: true } },
        },
      }),
      this.prisma.financeReceivable.findMany({
        where: { status: 'RECEIVED', receivedDate: dateRange, deletedAt: null, ...branchFilter },
        select: { receivedAmount: true, receivedDate: true },
      }),
      this.prisma.sale.findMany({
        where: { createdAt: dateRange, ...branchFilter },
        select: { createdAt: true, product: { select: { costPrice: true } } },
      }),
    ]);

    // FINANCE 51-54 expenses are added only when the caller explicitly asks
    // (includeFinanceExpenses) — see reports.service.shouldIncludeFinanceExpenses.
    let expenses: { totalAmount: Prisma.Decimal; expenseDate: Date }[] = [];
    if (includeFinanceExpenses) {
      const financeCompanyId = await this.companyResolver.getFinanceCompanyId();
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31, 23, 59, 59, 999);
      const expLines = await this.prisma.journalLine.findMany({
        where: {
          journalEntry: {
            status: 'POSTED',
            entryDate: { gte: start, lte: end },
            deletedAt: null,
            companyId: financeCompanyId,
          },
          deletedAt: null,
          OR: [
            { accountCode: { startsWith: '51-' } },
            { accountCode: { startsWith: '52-' } },
            { accountCode: { startsWith: '53-' } },
            { accountCode: { startsWith: '54-' } },
          ],
        },
        select: { debit: true, credit: true, journalEntry: { select: { entryDate: true } } },
      });
      expenses = expLines.map((l) => ({
        totalAmount: new Prisma.Decimal(l.debit ?? 0).sub(new Prisma.Decimal(l.credit ?? 0)),
        expenseDate: l.journalEntry.entryDate,
      }));
    }

    const months = Array.from({ length: 12 }, (_, i) => {
      let revenue = new Prisma.Decimal(0);
      let cogs = new Prisma.Decimal(0);
      let expenseTotal = new Prisma.Decimal(0);

      for (const s of sales) {
        if (getMonth(s.createdAt) !== i) continue;
        if (s.saleType === 'CASH') revenue = revenue.add(new Prisma.Decimal(s.netAmount ?? 0));
        if (s.saleType === 'INSTALLMENT' || s.saleType === 'EXTERNAL_FINANCE') {
          revenue = revenue.add(new Prisma.Decimal(s.downPaymentAmount ?? 0));
        }
      }

      for (const p of payments) {
        if (getMonth(p.paidDate) !== i) continue;
        if (p.monthlyPrincipal !== null) {
          // New: use stored breakdowns — principal + commission + interest + lateFee
          revenue = revenue
            .add(new Prisma.Decimal(p.monthlyPrincipal))
            .add(new Prisma.Decimal(p.monthlyCommission ?? 0))
            .add(new Prisma.Decimal(p.monthlyInterest ?? 0));
          if (!p.lateFeeWaived) revenue = revenue.add(new Prisma.Decimal(p.lateFee));
        } else {
          // Legacy fallback: amountPaid already includes everything
          revenue = revenue.add(new Prisma.Decimal(p.amountPaid));
        }
      }

      for (const f of financeRecs) {
        if (getMonth(f.receivedDate) !== i) continue;
        revenue = revenue.add(new Prisma.Decimal(f.receivedAmount ?? 0));
      }

      for (const s of productSales) {
        if (getMonth(s.createdAt) !== i) continue;
        cogs = cogs.add(new Prisma.Decimal(s.product.costPrice ?? 0));
      }

      for (const e of expenses) {
        if (getMonth(e.expenseDate) !== i) continue;
        expenseTotal = expenseTotal.add(new Prisma.Decimal(e.totalAmount));
      }

      const totalExpenses = cogs.add(expenseTotal);
      const revenueNum = revenue.toNumber();
      const expensesNum = totalExpenses.toNumber();
      return { month: i + 1, label: thaiMonths[i], revenue: revenueNum, expenses: expensesNum, netProfit: revenueNum - expensesNum };
    });

    return { year, months };
  }

  // ─── W-012: Comparative P&L (MoM / YoY) ──────────────────────────────────────

  async getComparativePL(
    year: number,
    month: number,
    branchId?: string,
    branchIds?: string[],
    includeFinanceExpenses = false,
  ) {
    // Helper: get last day of month as YYYY-MM-DD string (local time, no UTC shift)
    const lastDayOf = (y: number, m: number) => {
      const d = new Date(y, m, 0); // day 0 of next month = last day of m
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const startCurrent = `${year}-${String(month).padStart(2, '0')}-01`;
    const endCurrent = lastDayOf(year, month);

    // Previous month
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const startPrev = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
    const endPrev = lastDayOf(prevYear, prevMonth);

    // Same month last year
    const startYoY = `${year - 1}-${String(month).padStart(2, '0')}-01`;
    const endYoY = lastDayOf(year - 1, month);

    const [current, prevPeriod, lastYear] = await Promise.all([
      this.getProfitLossReport(startCurrent, endCurrent, branchId, branchIds, includeFinanceExpenses),
      this.getProfitLossReport(startPrev, endPrev, branchId, branchIds, includeFinanceExpenses),
      this.getProfitLossReport(startYoY, endYoY, branchId, branchIds, includeFinanceExpenses),
    ]);

    const pctChange = (curr: number, prev: number) =>
      prev === 0
        ? curr > 0
          ? 100
          : 0
        : Math.round(((curr - prev) / Math.abs(prev)) * 10000) / 100;

    return {
      current,
      previousMonth: prevPeriod,
      lastYear,
      momChange: {
        revenue: pctChange(current.revenue.totalRevenue, prevPeriod.revenue.totalRevenue),
        grossProfit: pctChange(current.grossProfit, prevPeriod.grossProfit),
        netProfit: pctChange(current.netProfit, prevPeriod.netProfit),
      },
      yoyChange: {
        revenue: pctChange(current.revenue.totalRevenue, lastYear.revenue.totalRevenue),
        grossProfit: pctChange(current.grossProfit, lastYear.grossProfit),
        netProfit: pctChange(current.netProfit, lastYear.netProfit),
      },
    };
  }

  // ─── Balance Sheet (derived from existing data, no general ledger) ────────────

  async getBalanceSheet(asOfDate: string, branchId?: string, branchIds?: string[]) {
    const endDate = new Date(asOfDate);
    endDate.setHours(23, 59, 59, 999);
    const branchFilter =
      branchIds !== undefined
        ? { branchId: { in: branchIds } }
        : branchId
          ? { branchId }
          : {};

    // ── ASSETS ──

    // 1110 Cash & Bank: Derived from cash inflows minus cash outflows
    const [paymentsReceived, cashSalesTotal, downPaymentsTotal, financeReceivedTotal, expensesPaid] =
      await Promise.all([
        // Installment payments received
        this.prisma.payment.aggregate({
          where: {
            status: 'PAID',
            paidDate: { lte: endDate },
            contract: { deletedAt: null, ...branchFilter },
          },
          _sum: { amountPaid: true },
        }),
        // Cash sales revenue
        this.prisma.sale.aggregate({
          where: { saleType: 'CASH', createdAt: { lte: endDate }, deletedAt: null, ...branchFilter },
          _sum: { netAmount: true },
        }),
        // Down payments from installment & external finance sales
        this.prisma.sale.aggregate({
          where: {
            saleType: { in: ['INSTALLMENT', 'EXTERNAL_FINANCE'] },
            createdAt: { lte: endDate },
            deletedAt: null,
            ...branchFilter,
          },
          _sum: { downPaymentAmount: true },
        }),
        // Finance company payments received
        this.prisma.financeReceivable.aggregate({
          where: { status: 'RECEIVED', receivedDate: { lte: endDate }, deletedAt: null, ...branchFilter },
          _sum: { receivedAmount: true },
        }),
        // Expenses paid (cash outflow) — legacy `expense` model removed; ExpenseDocument
        // integration deferred to a follow-up PR. Returns zero stub.
        Promise.resolve({ _sum: { totalAmount: null as Prisma.Decimal | null } }),
      ]);

    // Purchase orders paid (cash outflow for inventory)
    // Note: PurchaseOrder model has no branchId — PO costs are company-wide.
    // Branch-level Balance Sheet will show company-wide PO costs.
    const purchaseOrdersPaid = await this.prisma.purchaseOrder.aggregate({
      where: {
        paymentStatus: 'FULLY_PAID',
        orderDate: { lte: endDate },
        deletedAt: null,
      },
      _sum: { paidAmount: true },
    });

    const totalCashInflows = new Prisma.Decimal(paymentsReceived._sum.amountPaid ?? 0)
      .add(new Prisma.Decimal(cashSalesTotal._sum.netAmount ?? 0))
      .add(new Prisma.Decimal(downPaymentsTotal._sum.downPaymentAmount ?? 0))
      .add(new Prisma.Decimal(financeReceivedTotal._sum.receivedAmount ?? 0));
    const totalCashOutflows = new Prisma.Decimal(expensesPaid._sum.totalAmount ?? 0)
      .add(new Prisma.Decimal(purchaseOrdersPaid._sum.paidAmount ?? 0));
    const cashAndBank = totalCashInflows.sub(totalCashOutflows);

    // 1220 Hire-purchase receivables: Outstanding installments on active contracts
    const [hpReceivables, provisions, pendingFinance, inventory, creditBalances, whtPayable, accruedExpenses] =
      await Promise.all([
        // Unpaid/partially-paid installments on active contracts
        this.prisma.payment.aggregate({
          where: {
            status: { in: ['PENDING', 'PARTIALLY_PAID'] },
            contract: {
              deletedAt: null,
              status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
              ...branchFilter,
            },
          },
          _sum: { amountDue: true, amountPaid: true },
        }),
        // 1229 Allowance for doubtful accounts
        this.prisma.badDebtProvision.aggregate({
          where: { status: 'ACTIVE' },
          _sum: { provisionAmount: true },
        }),
        // 1230 Finance receivables (pending from external finance companies)
        this.prisma.financeReceivable.aggregate({
          where: { status: 'PENDING', deletedAt: null, ...branchFilter },
          _sum: { expectedAmount: true },
        }),
        // 1300 Inventory at cost
        this.prisma.product.aggregate({
          where: { status: 'IN_STOCK', deletedAt: null, ...(branchId ? { branchId } : {}) },
          _sum: { costPrice: true },
          _count: true,
        }),
        // 2510 Customer credit balances (overpayments held)
        this.prisma.contract.aggregate({
          where: { creditBalance: { gt: 0 }, deletedAt: null, ...branchFilter },
          _sum: { creditBalance: true },
        }),
        // 2300 WHT payable + 2600 Accrued expenses — legacy `expense` model removed;
        // ExpenseDocument integration deferred to a follow-up PR. Returns zero stubs.
        Promise.resolve({ _sum: { withholdingTax: null as Prisma.Decimal | null } }),
        Promise.resolve({ _sum: { totalAmount: null as Prisma.Decimal | null } }),
      ]);

    const grossReceivables = new Prisma.Decimal(hpReceivables._sum.amountDue ?? 0);
    const paidOnReceivables = new Prisma.Decimal(hpReceivables._sum.amountPaid ?? 0);
    const netReceivables = grossReceivables.sub(paidOnReceivables);
    const allowanceForDoubtful = new Prisma.Decimal(provisions._sum.provisionAmount ?? 0);
    const financeReceivables = new Prisma.Decimal(pendingFinance._sum.expectedAmount ?? 0);
    const inventoryValue = new Prisma.Decimal(inventory._sum.costPrice ?? 0);
    const inventoryCount = inventory._count || 0;

    const totalCurrentAssets = cashAndBank
      .add(netReceivables)
      .sub(allowanceForDoubtful)
      .add(financeReceivables)
      .add(inventoryValue);
    const totalAssets = totalCurrentAssets; // No fixed assets tracked in system

    // ── LIABILITIES ──

    const customerCreditBalances = new Prisma.Decimal(creditBalances._sum.creditBalance ?? 0);
    const totalWhtPayable = new Prisma.Decimal(whtPayable._sum.withholdingTax ?? 0);
    const totalAccrued = new Prisma.Decimal(accruedExpenses._sum.totalAmount ?? 0);

    const totalLiabilities = customerCreditBalances.add(totalWhtPayable).add(totalAccrued);

    // ── EQUITY ──
    // Retained earnings = Total Assets - Total Liabilities (balancing figure)
    // In a full accounting system this would come from accumulated P&L; here we derive it.
    const retainedEarnings = totalAssets.sub(totalLiabilities);

    const grossReceivablesNum = grossReceivables.toNumber();
    const paidOnReceivablesNum = paidOnReceivables.toNumber();
    const netReceivablesNum = netReceivables.toNumber();
    const allowanceForDoubtfulNum = allowanceForDoubtful.toNumber();
    const financeReceivablesNum = financeReceivables.toNumber();
    const inventoryValueNum = inventoryValue.toNumber();
    const cashAndBankNum = cashAndBank.toNumber();
    const totalCurrentAssetsNum = totalCurrentAssets.toNumber();
    const totalAssetsNum = totalAssets.toNumber();
    const customerCreditBalancesNum = customerCreditBalances.toNumber();
    const totalWhtPayableNum = totalWhtPayable.toNumber();
    const totalAccruedNum = totalAccrued.toNumber();
    const totalLiabilitiesNum = totalLiabilities.toNumber();
    const retainedEarningsNum = retainedEarnings.toNumber();

    return {
      asOfDate,
      assets: {
        currentAssets: {
          cashAndBank: cashAndBankNum,
          hirePurchaseReceivables: {
            gross: grossReceivablesNum,
            paid: paidOnReceivablesNum,
            net: netReceivablesNum,
            allowanceForDoubtful: -allowanceForDoubtfulNum,
            netAfterAllowance: netReceivablesNum - allowanceForDoubtfulNum,
          },
          financeReceivables: financeReceivablesNum,
          inventory: { value: inventoryValueNum, count: inventoryCount },
          totalCurrentAssets: totalCurrentAssetsNum,
        },
        totalAssets: totalAssetsNum,
      },
      liabilities: {
        currentLiabilities: {
          customerCreditBalances: customerCreditBalancesNum,
          withholdingTaxPayable: totalWhtPayableNum,
          accruedExpenses: totalAccruedNum,
        },
        totalLiabilities: totalLiabilitiesNum,
      },
      equity: {
        retainedEarnings: retainedEarningsNum,
        totalEquity: retainedEarningsNum,
      },
      // Note: Balance Sheet is derived (not from general ledger). Retained earnings is
      // calculated as Assets - Liabilities, so it always balances by definition.
      // When a general ledger is implemented, this should verify A = L + E independently.
    };
  }

  // ─── Cash Flow Statement (derived from existing data, no general ledger) ──────

  async getCashFlowStatement(startDate: string, endDate: string, branchId?: string, branchIds?: string[]) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const dateRange = { gte: start, lte: end };
    const branchFilter =
      branchIds !== undefined
        ? { branchId: { in: branchIds } }
        : branchId
          ? { branchId }
          : {};

    // ── OPERATING ACTIVITIES ──

    const [cashSales, downPayments, installmentPayments, financeReceived, expensesPaid] =
      await Promise.all([
        // Cash received from direct cash sales
        this.prisma.sale.aggregate({
          where: { saleType: 'CASH', createdAt: dateRange, deletedAt: null, ...branchFilter },
          _sum: { netAmount: true },
        }),
        // Cash received from down payments (installment + external finance)
        this.prisma.sale.aggregate({
          where: {
            saleType: { in: ['INSTALLMENT', 'EXTERNAL_FINANCE'] },
            createdAt: dateRange,
            deletedAt: null,
            ...branchFilter,
          },
          _sum: { downPaymentAmount: true },
        }),
        // Cash received from installment payments
        this.prisma.payment.aggregate({
          where: {
            status: 'PAID',
            paidDate: dateRange,
            contract: { deletedAt: null, ...branchFilter },
          },
          _sum: { amountPaid: true, lateFee: true },
        }),
        // Cash received from finance companies
        this.prisma.financeReceivable.aggregate({
          where: { status: 'RECEIVED', receivedDate: dateRange, deletedAt: null, ...branchFilter },
          _sum: { receivedAmount: true },
        }),
        // Cash paid for expenses — legacy `expense` model removed; ExpenseDocument
        // integration deferred to a follow-up PR. Returns zero stub.
        Promise.resolve({ _sum: { totalAmount: null as Prisma.Decimal | null } }),
      ]);

    // Cash paid for inventory (purchase orders paid in the period)
    // Note: PurchaseOrder has no branchId — PO costs are company-wide
    const purchaseOrdersPaid = await this.prisma.purchaseOrder.aggregate({
      where: {
        paymentStatus: { in: ['FULLY_PAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID'] },
        orderDate: dateRange,
        deletedAt: null,
      },
      _sum: { paidAmount: true },
    });

    const cashFromSales = new Prisma.Decimal(cashSales._sum.netAmount ?? 0);
    const cashFromDownPayments = new Prisma.Decimal(downPayments._sum.downPaymentAmount ?? 0);
    // C-3 fix: amountPaid already includes lateFee portion (customer pays amountDue + lateFee as one sum)
    // so we don't add lateFee separately to avoid double-counting
    const cashFromInstallments = new Prisma.Decimal(installmentPayments._sum.amountPaid ?? 0);
    const cashFromFinanceCompanies = new Prisma.Decimal(financeReceived._sum.receivedAmount ?? 0);

    const cashFromCustomers = cashFromSales
      .add(cashFromDownPayments)
      .add(cashFromInstallments)
      .add(cashFromFinanceCompanies);

    const cashPaidForExpenses = new Prisma.Decimal(expensesPaid._sum.totalAmount ?? 0);
    const cashPaidForInventory = new Prisma.Decimal(purchaseOrdersPaid._sum.paidAmount ?? 0);

    const netOperating = cashFromCustomers.sub(cashPaidForExpenses).sub(cashPaidForInventory);

    // No investing or financing activities are tracked separately in this system
    const netCashChange = netOperating;

    const cashFromCustomersNum = cashFromCustomers.toNumber();
    const cashFromSalesNum = cashFromSales.toNumber();
    const cashFromDownPaymentsNum = cashFromDownPayments.toNumber();
    const cashFromInstallmentsNum = cashFromInstallments.toNumber();
    const cashFromFinanceCompaniesNum = cashFromFinanceCompanies.toNumber();
    const cashPaidForExpensesNum = cashPaidForExpenses.toNumber();
    const cashPaidForInventoryNum = cashPaidForInventory.toNumber();
    const netOperatingNum = netOperating.toNumber();

    return {
      period: { start: startDate, end: endDate },
      operatingActivities: {
        cashFromCustomers: cashFromCustomersNum,
        cashFromSales: cashFromSalesNum,
        cashFromDownPayments: cashFromDownPaymentsNum,
        cashFromInstallments: cashFromInstallmentsNum, // includes lateFee portion (amountPaid = principal + interest + lateFee)
        cashFromFinanceCompanies: cashFromFinanceCompaniesNum,
        cashPaidForExpenses: -cashPaidForExpensesNum,
        cashPaidForInventory: -cashPaidForInventoryNum,
        netOperatingCashFlow: netOperatingNum,
      },
      netCashChange: netCashChange.toNumber(),
    };
  }
}
