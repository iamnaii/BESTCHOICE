import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StructuredLoggerService } from '../../common/logger';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';

/**
 * INVENTORY COSTING METHOD: Specific Identification
 * Each product has a unique costPrice (IMEI-level tracking).
 * COGS is calculated as the specific costPrice of the sold product.
 * This is compliant with TAS 2 for items that are not interchangeable.
 */
export const INVENTORY_COSTING_METHOD = 'SPECIFIC_IDENTIFICATION' as const;

// Legacy CATEGORY_ACCOUNT_MAP / CATEGORY_CODE_MAP / generateExpenseNumber were removed
// alongside the legacy Expense model. The new ExpenseDocument module owns category↔code
// resolution and document numbering — see modules/expense-documents/.

// Phase A.6 boot validator was tied to the legacy CATEGORY_CODE_MAP — the new
// ExpenseDocument module performs its own CoA validation at document creation time.

/**
 * ═══════════════════════════════════════════════════════════════
 * นโยบายการบัญชี (Accounting Policies) — BESTCHOICE
 * มาตรฐาน: TFRS for NPAEs (กิจการที่ไม่มีส่วนได้เสียสาธารณะ)
 * ═══════════════════════════════════════════════════════════════
 *
 * 1. การรับรู้รายได้ (Revenue Recognition) — เกณฑ์เงินสด (Cash Basis)
 *    - ขายเงินสด: รับรู้เมื่อส่งมอบสินค้าและรับเงิน
 *    - ขายผ่อน (เงินดาวน์): รับรู้เมื่อรับเงินดาวน์
 *    - ขายผ่อน (งวดผ่อน): รับรู้เมื่อลูกค้าชำระแต่ละงวด
 *    - ไฟแนนซ์ภายนอก: รับรู้เมื่อได้รับเงินจากบริษัทไฟแนนซ์
 *    หมายเหตุ: amountPaid รวมเงินต้น + ดอกเบี้ย + ค่าปรับ ทั้งหมดไว้แล้ว
 *
 * 2. ดอกเบี้ยเช่าซื้อ — Straight-line method (เกณฑ์เส้นตรง)
 *    - ดอกเบี้ยรายเดือน = ดอกเบี้ยรวม / จำนวนงวด
 *    - เป็นค่า memo สำหรับแสดงผลใน P&L (ไม่บวกเพิ่มจาก amountPaid)
 *
 * 3. ค่าใช้จ่าย — เกณฑ์คงค้าง (Accrual Basis)
 *    - บันทึกเมื่อเกิดรายการ ไม่ว่าจะจ่ายเงินแล้วหรือยัง
 *
 * 4. สินค้าคงเหลือ — Specific Identification (ระบุเฉพาะ)
 *    - สินค้าแต่ละชิ้นมี costPrice เฉพาะ (IMEI-level tracking)
 */
@Injectable()
export class AccountingService implements OnModuleInit {
  private readonly logger = new Logger(AccountingService.name);
  private readonly structuredLogger = new StructuredLoggerService(AccountingService.name);
  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    // P3-SP5 W7: defense-in-depth filter on companyId for SHOP/FINANCE scoping.
    private companyResolver: CompanyResolverService,
  ) {}

  /**
   * Boot hook retained for future CoA validation needs. Legacy CATEGORY_CODE_MAP
   * validation moved to the new ExpenseDocument module.
   */
  async onModuleInit() {
    // No-op — see ExpenseDocument module for CoA validation.
  }

  /**
   * Resolve companyId to an array of branchIds belonging to that company.
   * Used to scope financial reports by company entity.
   */
  async getBranchIdsForCompany(companyId: string): Promise<string[]> {
    const branches = await this.prisma.branch.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true },
    });
    return branches.map((b) => b.id);
  }


  // ─── P&L Calculation ─────────────────────────────────────────────────────────

  async getProfitLossReport(startDate: string, endDate: string, branchId?: string, branchIds?: string[]) {
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
      expensesByCategory,
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
      // Legacy `expense` model removed — expense aggregation deferred to ExpenseDocument
      // module integration in a follow-up PR. Returns empty list so downstream maps stay zero.
      Promise.resolve([] as { category: string; totalAmount: Prisma.Decimal }[]),
      this.prisma.sale.findMany({
        where: { createdAt: dateRange, deletedAt: null, ...branchFilter },
        select: { product: { select: { costPrice: true } }, bundleProductIds: true },
      }),
    ]);

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
    const totalSelling = sellCommission.add(sellAdvertising).add(sellTransport).add(sellPackaging);

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
    const totalAdmin = adminSalary.add(adminSocialSecurity).add(adminRent).add(adminUtilities)
      .add(adminOfficeSupplies).add(adminDepreciation).add(adminInsurance).add(adminTaxFee)
      .add(adminMaintenance).add(adminTravel).add(adminTelephone);

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
    const totalOther = otherInterest.add(otherLoss).add(otherFine).add(otherMisc);

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
      summary: {
        totalRevenue: totalRevenueNum,
        totalExpenses: totalExpenses.toNumber(),
        netProfit: netProfitNum,
        profitMargin: totalRevenueNum > 0 ? Math.round((netProfitNum / totalRevenueNum) * 10000) / 100 : 0,
      },
    };
  }

  async getMonthlyPLSummary(year: number, branchId?: string, branchIds?: string[]) {
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

    const [sales, payments, financeRecs, expenses, productSales] = await Promise.all([
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
      // Legacy `expense` model removed — expense aggregation deferred to ExpenseDocument
      // module integration in a follow-up PR. Returns empty list so downstream sums stay zero.
      Promise.resolve([] as { totalAmount: Prisma.Decimal; expenseDate: Date }[]),
      this.prisma.sale.findMany({
        where: { createdAt: dateRange, ...branchFilter },
        select: { createdAt: true, product: { select: { costPrice: true } } },
      }),
    ]);

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

  async getComparativePL(year: number, month: number, branchId?: string, branchIds?: string[]) {
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
      this.getProfitLossReport(startCurrent, endCurrent, branchId, branchIds),
      this.getProfitLossReport(startPrev, endPrev, branchId, branchIds),
      this.getProfitLossReport(startYoY, endYoY, branchId, branchIds),
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

  // ─── W-013: Period Closing Lock ───────────────────────────────────────────────

  async closeAccountingPeriod(closedUntil: string) {
    await this.prisma.systemConfig.upsert({
      where: { key: 'accounting_period_closed_until' },
      update: { value: closedUntil },
      create: { key: 'accounting_period_closed_until', value: closedUntil },
    });
    this.structuredLogger.log('accounting.period.closed', { closedUntil });
    return { closedUntil };
  }

  async getAccountingPeriodStatus() {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'accounting_period_closed_until' },
    });
    return { closedUntil: config?.value || null };
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

  // ─── T17: Journal-line-based Trial Balance / P&L / Balance Sheet ─────────────
  //
  // These methods pull from the JournalEntry/JournalLine general ledger (Phase A.4
  // CPA chart). They are distinct from getProfitLossReport / getBalanceSheet (which
  // pull from raw transactional tables and are retained for backward compat).
  //
  // Account code prefix → section mapping (FINANCE 99-account chart):
  //   11 = สินทรัพย์หมุนเวียน (Current Assets)
  //   12 = สินทรัพย์ไม่หมุนเวียน (Non-Current Assets)
  //   21 = หนี้สินหมุนเวียน (Current Liabilities)
  //   22 = หนี้สินไม่หมุนเวียน (Non-Current Liabilities)
  //   31 = ทุนจดทะเบียน (Share Capital)
  //   32 = กำไรสะสม (Retained Earnings)
  //   33 = กำไรขาดทุนปีปัจจุบัน (Current Year Profit)
  //   41 = รายได้จากการดำเนินงาน (Operating Revenue)
  //   42 = รายได้อื่น (Other Income)
  //   51 = ต้นทุนทางการเงิน (Finance Costs)
  //   52 = ค่าใช้จ่ายขาย (Selling Expenses)
  //   53 = ค่าใช้จ่ายบริหาร (Admin Expenses)
  //   54 = ค่าใช้จ่ายต้องห้าม (Tax-disallowed Expenses)
  //   55 = EXCLUDE from P&L (พีคโปรแกรม — ไม่นำมาแสดงในงบกำไรขาดทุน)

  private static readonly SECTION_MAP: Record<string, string> = {
    // FINANCE chart (single-prefix)
    '11': 'สินทรัพย์หมุนเวียน',
    '12': 'สินทรัพย์ไม่หมุนเวียน',
    '21': 'หนี้สินหมุนเวียน',
    '22': 'หนี้สินไม่หมุนเวียน',
    '31': 'ทุนจดทะเบียน',
    '32': 'กำไรสะสม',
    '33': 'กำไรขาดทุนปีปัจจุบัน',
    '41': 'รายได้จากการดำเนินงาน',
    '42': 'รายได้อื่น',
    '51': 'ต้นทุนทางการเงิน',
    '52': 'ค่าใช้จ่ายขาย',
    '53': 'ค่าใช้จ่ายบริหาร',
    '54': 'ค่าใช้จ่ายต้องห้ามทางภาษี',
    '55': 'ค่าใช้จ่ายโปรแกรมบัญชี (ยกเว้น P&L)',
    // P3-SP5 — SHOP chart (S-prefix). Same logical grouping as FINANCE but
    // labelled "(SHOP)" so a combined report makes it obvious which side a
    // section came from.
    'S11': 'สินทรัพย์หมุนเวียน (SHOP)',
    'S12': 'สินทรัพย์ไม่หมุนเวียน (SHOP)',
    'S21': 'หนี้สินหมุนเวียน (SHOP)',
    'S22': 'หนี้สินไม่หมุนเวียน (SHOP)',
    'S31': 'ทุนจดทะเบียน (SHOP)',
    'S32': 'กำไรสะสม (SHOP)',
    'S33': 'กำไรขาดทุนปีปัจจุบัน (SHOP)',
    'S41': 'รายได้ (SHOP)',
    'S42': 'รายได้อื่น (SHOP)',
    'S50': 'ต้นทุนขาย (SHOP)',
    'S51': 'ค่าใช้จ่ายขาย (SHOP)',
    'S52': 'ค่าใช้จ่ายบริหาร (SHOP)',
    'S53': 'ค่าใช้จ่ายอื่น (SHOP)',
  };

  /**
   * Extract the section-prefix from an account code.
   * - FINANCE: `11-1101` → `11` (first 2 chars)
   * - SHOP:    `S11-1101` → `S11` (first 3 chars, S + 2 digits)
   */
  private static codePrefix(code: string): string {
    return code.startsWith('S') ? code.slice(0, 3) : code.slice(0, 2);
  }

  /**
   * Get Trial Balance from journal lines as of a given date.
   *
   * Queries all ChartOfAccount records and sums JournalLine debit/credit
   * from POSTED JournalEntries with entryDate <= asOfDate.
   *
   * Sections are grouped by the 2-digit prefix of the account code (11, 12, 21, …).
   * isBalanced = grandDrTotal equals grandCrTotal (accounting identity check).
   *
   * P3-SP5: `scope` filters by account code prefix:
   *   - 'FINANCE' (default) — codes WITHOUT `S` prefix (the FINANCE chart)
   *   - 'SHOP'              — codes WITH    `S` prefix (the SHOP chart)
   *   - 'ALL'               — all accounts (combined report — both prefixes)
   *
   * Filtering happens on `chartOfAccount.code` and `journalLine.accountCode`
   * at the DB level so SHOP/FINANCE running balances stay strictly separate.
   */
  async getTrialBalance(asOfDate?: Date, scope: 'FINANCE' | 'SHOP' | 'ALL' = 'FINANCE') {
    const cutoff = asOfDate ?? new Date();

    // Code-prefix filter: SHOP codes start with 'S' (S11-XXXX); FINANCE codes
    // are bare digits (11-XXXX). Use Prisma `startsWith` for the SHOP filter
    // and `not.startsWith` for FINANCE. 'ALL' skips the filter entirely.
    const codeFilter: Prisma.StringFilter | undefined =
      scope === 'SHOP'
        ? { startsWith: 'S' }
        : scope === 'FINANCE'
          ? { not: { startsWith: 'S' } }
          : undefined;

    // P3-SP5 W7 — defense-in-depth: ALSO filter by JournalEntry.companyId.
    // Code-prefix is the partition key but companyId guards against the
    // edge case of a misposted JE (S-code lines under FINANCE companyId
    // or vice versa). 'ALL' skips this filter so combined views work.
    const companyIdFilter: string | undefined =
      scope === 'SHOP'
        ? await this.companyResolver.getShopCompanyId()
        : scope === 'FINANCE'
          ? await this.companyResolver.getFinanceCompanyId()
          : undefined;

    // 1. Load all active chart of accounts (scoped)
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: {
        deletedAt: null,
        status: 'ใช้งาน',
        ...(codeFilter ? { code: codeFilter } : {}),
      },
      orderBy: { code: 'asc' },
    });

    // 2. Sum journal lines per accountCode from POSTED entries up to cutoff
    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        journalEntry: {
          status: 'POSTED',
          entryDate: { lte: cutoff },
          deletedAt: null,
          ...(companyIdFilter ? { companyId: companyIdFilter } : {}),
        },
        deletedAt: null,
        ...(codeFilter ? { accountCode: codeFilter } : {}),
      },
      _sum: { debit: true, credit: true },
    });

    const sumMap = new Map<string, { dr: Prisma.Decimal; cr: Prisma.Decimal }>();
    for (const row of lineSums) {
      sumMap.set(row.accountCode, {
        dr: new Prisma.Decimal(row._sum.debit ?? 0),
        cr: new Prisma.Decimal(row._sum.credit ?? 0),
      });
    }

    // 3. Build per-section rows (include accounts with activity even if CoA doesn't exist,
    //    and include CoA accounts with zero balances)
    const sectionMap = new Map<string, {
      sectionName: string;
      codePrefix: string;
      rows: {
        code: string; name: string; type: string; normalBalance: string;
        drBalance: Prisma.Decimal; crBalance: Prisma.Decimal; netBalance: Prisma.Decimal;
      }[];
      drTotal: Prisma.Decimal;
      crTotal: Prisma.Decimal;
    }>();

    for (const acc of accounts) {
      const prefix = AccountingService.codePrefix(acc.code);
      const sectionName = AccountingService.SECTION_MAP[prefix] ?? `หมวด ${prefix}`;

      if (!sectionMap.has(prefix)) {
        sectionMap.set(prefix, {
          sectionName,
          codePrefix: prefix,
          rows: [],
          drTotal: new Prisma.Decimal(0),
          crTotal: new Prisma.Decimal(0),
        });
      }

      const sums = sumMap.get(acc.code) ?? { dr: new Prisma.Decimal(0), cr: new Prisma.Decimal(0) };
      // netBalance: Dr-normal → dr - cr; Cr-normal → cr - dr; Dr/Cr → dr - cr (default Dr)
      const netBalance = acc.normalBalance === 'Cr'
        ? sums.cr.sub(sums.dr)
        : sums.dr.sub(sums.cr);

      const section = sectionMap.get(prefix)!;
      section.rows.push({
        code: acc.code,
        name: acc.name,
        type: acc.type,
        normalBalance: acc.normalBalance,
        drBalance: sums.dr,
        crBalance: sums.cr,
        netBalance,
      });
      section.drTotal = section.drTotal.add(sums.dr);
      section.crTotal = section.crTotal.add(sums.cr);
    }

    // Also include any journal lines for codes not in CoA (orphan codes)
    for (const [code, sums] of sumMap) {
      const prefix = AccountingService.codePrefix(code);
      if (!sectionMap.has(prefix)) {
        sectionMap.set(prefix, {
          sectionName: AccountingService.SECTION_MAP[prefix] ?? `หมวด ${prefix}`,
          codePrefix: prefix,
          rows: [],
          drTotal: new Prisma.Decimal(0),
          crTotal: new Prisma.Decimal(0),
        });
      }
      const section = sectionMap.get(prefix)!;
      // Check if already added via CoA iteration
      if (!section.rows.find((r) => r.code === code)) {
        section.rows.push({
          code,
          name: `[ไม่พบในผังบัญชี] ${code}`,
          type: 'ไม่ระบุ',
          normalBalance: 'Dr',
          drBalance: sums.dr,
          crBalance: sums.cr,
          netBalance: sums.dr.sub(sums.cr),
        });
        section.drTotal = section.drTotal.add(sums.dr);
        section.crTotal = section.crTotal.add(sums.cr);
      }
    }

    // 4. Sort sections by code prefix and compute grand totals
    const sections = Array.from(sectionMap.values()).sort((a, b) =>
      a.codePrefix.localeCompare(b.codePrefix),
    );

    let grandDrTotal = new Prisma.Decimal(0);
    let grandCrTotal = new Prisma.Decimal(0);
    for (const s of sections) {
      grandDrTotal = grandDrTotal.add(s.drTotal);
      grandCrTotal = grandCrTotal.add(s.crTotal);
    }

    // P3-SP5 DEEP review C5 — per-scope subtotals + per-scope balance check.
    //
    // For scope='ALL' the combined Dr / Cr totals can sum to zero even if
    // the SHOP half is unbalanced and the FINANCE half is unbalanced by
    // the same magnitude in opposite directions. That hides real bugs.
    // Always return strict per-scope totals so the UI can show TWO balance
    // badges (SHOP balanced / FINANCE balanced) instead of one combined.
    const shopDr = sections
      .filter((s) => s.codePrefix.startsWith('S'))
      .reduce((acc, s) => acc.add(s.drTotal), new Prisma.Decimal(0));
    const shopCr = sections
      .filter((s) => s.codePrefix.startsWith('S'))
      .reduce((acc, s) => acc.add(s.crTotal), new Prisma.Decimal(0));
    const financeDr = sections
      .filter((s) => !s.codePrefix.startsWith('S'))
      .reduce((acc, s) => acc.add(s.drTotal), new Prisma.Decimal(0));
    const financeCr = sections
      .filter((s) => !s.codePrefix.startsWith('S'))
      .reduce((acc, s) => acc.add(s.crTotal), new Prisma.Decimal(0));

    const shopBalanced = shopDr.equals(shopCr);
    const financeBalanced = financeDr.equals(financeCr);
    // isAllBalanced is STRICTER than the combined Dr=Cr check — both halves
    // MUST balance independently. Combined Dr=Cr alone is not enough.
    const isAllBalanced =
      scope === 'ALL'
        ? shopBalanced && financeBalanced
        : scope === 'SHOP'
          ? shopBalanced
          : financeBalanced;

    return {
      asOfDate: cutoff,
      scope,
      sections,
      grandDrTotal,
      grandCrTotal,
      // Per-scope subtotals (always populated; consumers can show them per
      // their needs — UI shows both badges when scope='ALL').
      perScope: {
        shop: {
          drTotal: shopDr,
          crTotal: shopCr,
          isBalanced: shopBalanced,
        },
        finance: {
          drTotal: financeDr,
          crTotal: financeCr,
          isBalanced: financeBalanced,
        },
      },
      // Legacy combined balance check (kept for backward compatibility but
      // do NOT rely on it for scope='ALL' — use `isAllBalanced` instead).
      isBalanced: grandDrTotal.equals(grandCrTotal),
      isAllBalanced,
    };
  }

  /**
   * Get P&L from journal lines for a given period.
   *
   * Revenue = net Cr balance of accounts 41 + 42 for the period.
   * Expenses = net Dr balance of accounts 51 + 52 + 53 + 54 for the period.
   * COGS    = net Dr balance of S50 (SHOP only — FINANCE does not carry COGS).
   * Accounts in prefix 55 are EXCLUDED per CPA chart note ("ไม่นำมาแสดงในงบกำไรขาดทุน").
   *
   * Period filter: JournalEntry.entryDate between periodStart and periodEnd (inclusive).
   *
   * Optional companyId scopes to JournalEntry.companyId — used by multi-entity
   * reports (SP2 Cash Flow / Equity Statement / General Ledger).
   *
   * P3-SP5: `scope` filters by account code prefix:
   *   - 'FINANCE' (default) — codes WITHOUT `S` prefix
   *   - 'SHOP'              — codes WITH    `S` prefix (S41, S42, S50, S51, S52, S53)
   *   - 'ALL'               — both
   */
  async getProfitLossFromJournal(
    periodStart: Date,
    periodEnd: Date,
    companyId?: string,
    scope: 'FINANCE' | 'SHOP' | 'ALL' = 'FINANCE',
  ) {
    // Prefixes per scope. SHOP introduces S50-XXXX COGS (treated as
    // expense in the P&L — separately reported under "ต้นทุนขาย").
    const REVENUE_PREFIXES =
      scope === 'SHOP'
        ? ['S41', 'S42']
        : scope === 'ALL'
          ? ['41', '42', 'S41', 'S42']
          : ['41', '42'];
    const EXPENSE_PREFIXES =
      scope === 'SHOP'
        ? ['S50', 'S51', 'S52', 'S53']
        : scope === 'ALL'
          ? ['51', '52', '53', '54', 'S50', 'S51', 'S52', 'S53']
          : ['51', '52', '53', '54']; // 55 excluded

    const codeFilter: Prisma.StringFilter | undefined =
      scope === 'SHOP'
        ? { startsWith: 'S' }
        : scope === 'FINANCE'
          ? { not: { startsWith: 'S' } }
          : undefined;

    // P3-SP5 W7 — defense-in-depth companyId filter (see getTrialBalance for
    // rationale). Honour an explicit `companyId` override from callers that
    // already know the company; otherwise resolve from scope.
    let companyIdFilter: string | undefined = companyId;
    if (!companyIdFilter) {
      if (scope === 'SHOP') {
        companyIdFilter = await this.companyResolver.getShopCompanyId();
      } else if (scope === 'FINANCE') {
        companyIdFilter = await this.companyResolver.getFinanceCompanyId();
      }
      // scope === 'ALL' leaves companyIdFilter unset (cross-company view).
    }

    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          ...(companyIdFilter ? { companyId: companyIdFilter } : {}),
        },
        deletedAt: null,
        ...(codeFilter ? { accountCode: codeFilter } : {}),
      },
      _sum: { debit: true, credit: true },
    });

    // Load CoA for names
    const codes = lineSums.map((r) => r.accountCode);
    const coaRecords = codes.length > 0
      ? await this.prisma.chartOfAccount.findMany({
          where: { code: { in: codes }, deletedAt: null },
          select: { code: true, name: true },
        })
      : [];
    const nameMap = new Map(coaRecords.map((c) => [c.code, c.name]));

    const revenueRows: { code: string; name: string; amount: Prisma.Decimal }[] = [];
    const expenseRows: { code: string; name: string; amount: Prisma.Decimal }[] = [];
    let revenueTotal = new Prisma.Decimal(0);
    let expenseTotal = new Prisma.Decimal(0);

    // P3-SP5 DEEP review C5 — per-scope subtotals so the UI can show SHOP
    // vs FINANCE side-by-side without re-querying.
    let shopRevenueTotal = new Prisma.Decimal(0);
    let shopExpenseTotal = new Prisma.Decimal(0);
    let financeRevenueTotal = new Prisma.Decimal(0);
    let financeExpenseTotal = new Prisma.Decimal(0);

    for (const row of lineSums) {
      const prefix = AccountingService.codePrefix(row.accountCode);
      const dr = new Prisma.Decimal(row._sum.debit ?? 0);
      const cr = new Prisma.Decimal(row._sum.credit ?? 0);
      const name = nameMap.get(row.accountCode) ?? row.accountCode;
      const isShop = row.accountCode.startsWith('S');

      if (REVENUE_PREFIXES.includes(prefix)) {
        // Revenue accounts are Cr-normal: net = Cr - Dr
        const amount = cr.sub(dr);
        revenueRows.push({ code: row.accountCode, name, amount });
        revenueTotal = revenueTotal.add(amount);
        if (isShop) shopRevenueTotal = shopRevenueTotal.add(amount);
        else financeRevenueTotal = financeRevenueTotal.add(amount);
      } else if (EXPENSE_PREFIXES.includes(prefix)) {
        // Expense accounts are Dr-normal: net = Dr - Cr
        const amount = dr.sub(cr);
        expenseRows.push({ code: row.accountCode, name, amount });
        expenseTotal = expenseTotal.add(amount);
        if (isShop) shopExpenseTotal = shopExpenseTotal.add(amount);
        else financeExpenseTotal = financeExpenseTotal.add(amount);
      }
      // prefix 55 and others: skip
    }

    revenueRows.sort((a, b) => a.code.localeCompare(b.code));
    expenseRows.sort((a, b) => a.code.localeCompare(b.code));

    return {
      periodStart,
      periodEnd,
      scope,
      revenue: {
        sectionName: 'รายได้รวม',
        rows: revenueRows,
        total: revenueTotal,
      },
      expenses: {
        sectionName: 'ค่าใช้จ่ายรวม',
        rows: expenseRows,
        total: expenseTotal,
      },
      netIncome: revenueTotal.sub(expenseTotal),
      // P3-SP5 DEEP review C5 — per-scope subtotals (always populated).
      // For scope='ALL' the UI displays BOTH side-by-side; for SHOP/FINANCE
      // the other side will be 0.
      perScope: {
        shop: {
          revenueTotal: shopRevenueTotal,
          expenseTotal: shopExpenseTotal,
          netIncome: shopRevenueTotal.sub(shopExpenseTotal),
        },
        finance: {
          revenueTotal: financeRevenueTotal,
          expenseTotal: financeExpenseTotal,
          netIncome: financeRevenueTotal.sub(financeExpenseTotal),
        },
      },
    };
  }

  /**
   * Get Balance Sheet from journal lines as of a given date.
   *
   * Assets (11 + 12): Dr-normal accounts add, Contra assets (type='สินทรัพย์ (Contra)'
   *   or normalBalance='Cr') subtract.
   * Liabilities (21 + 22): Cr-normal sums.
   * Equity (31 + 32 + 33): Cr-normal sums.
   *
   * isBalanced: assets.total === liabilities.total + equity.total
   */
  async getBalanceSheetFromJournal(asOfDate?: Date) {
    const cutoff = asOfDate ?? new Date();
    // P3-SP5 W1: explicit 'FINANCE' scope — this method historically reports
    // the FINANCE-side balance sheet. SHOP balance sheet is deferred to SP7.
    const tb = await this.getTrialBalance(cutoff, 'FINANCE');

    const zero = new Prisma.Decimal(0);

    // Helper: sum net balances for a set of code prefixes within trial balance sections
    const sumNetForPrefixes = (prefixes: string[]) => {
      let total = zero;
      for (const section of tb.sections) {
        if (!prefixes.includes(section.codePrefix)) continue;
        for (const row of section.rows) {
          // For Contra assets (Cr-normal inside asset sections):
          // netBalance is already negative (cr - dr when Cr-normal), so adding it reduces total — correct.
          // For Dr-normal assets: netBalance is positive — adds to total.
          total = total.add(row.netBalance);
        }
      }
      return total;
    };

    const buildSection = (prefixes: string[]) => {
      const rows: { code: string; name: string; type: string; normalBalance: string; netBalance: Prisma.Decimal }[] = [];
      for (const section of tb.sections) {
        if (!prefixes.includes(section.codePrefix)) continue;
        for (const row of section.rows) {
          rows.push({ code: row.code, name: row.name, type: row.type, normalBalance: row.normalBalance, netBalance: row.netBalance });
        }
      }
      rows.sort((a, b) => a.code.localeCompare(b.code));
      const total = rows.reduce((sum, r) => sum.add(r.netBalance), zero);
      return { rows, total };
    };

    const currentAssets = buildSection(['11']);
    const nonCurrentAssets = buildSection(['12']);
    const assetsTotal = currentAssets.total.add(nonCurrentAssets.total);

    const currentLiabilities = buildSection(['21']);
    const nonCurrentLiabilities = buildSection(['22']);
    const liabilitiesTotal = currentLiabilities.total.add(nonCurrentLiabilities.total);

    const equity = buildSection(['31', '32', '33']);

    const isBalanced = assetsTotal.equals(liabilitiesTotal.add(equity.total));

    return {
      asOfDate: cutoff,
      assets: {
        current: { ...currentAssets, sectionName: 'สินทรัพย์หมุนเวียน' },
        nonCurrent: { ...nonCurrentAssets, sectionName: 'สินทรัพย์ไม่หมุนเวียน' },
        total: assetsTotal,
      },
      liabilities: {
        current: { ...currentLiabilities, sectionName: 'หนี้สินหมุนเวียน' },
        nonCurrent: { ...nonCurrentLiabilities, sectionName: 'หนี้สินไม่หมุนเวียน' },
        total: liabilitiesTotal,
      },
      equity: { ...equity, sectionName: 'ส่วนของผู้ถือหุ้น' },
      isBalanced,
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

  // ─── SP2: Cash Flow (Indirect Method) ─────────────────────────────────────────
  //
  // TFRS for NPAEs Indirect Method:
  //   1. Net Income (from getProfitLossFromJournal)
  //   2. + Non-cash adjustments (depreciation, bad-debt provision Δ, unearned interest Δ)
  //   3. ± Working capital Δ (AR, Inventory, AP, VAT payable)
  //   4. Investing (PPE purchases / disposals)
  //   5. Financing (capital injections / dividends)
  //   6. Net Change reconciled vs. actual cash account movement (±1 THB tolerance)

  /**
   * Sum net balance of a list of account-code prefixes as of a specific date.
   * Aggregates over JournalLine on POSTED entries (entryDate <= asOfDate).
   *
   * normalSide controls signing:
   *   - 'Dr' → returns (debit - credit). Positive = balance on debit side.
   *   - 'Cr' → returns (credit - debit). Positive = balance on credit side.
   *
   * Optional companyId scopes to JournalEntry.companyId (multi-entity reports).
   */
  private async sumAccountBalances(
    codePrefixes: string[],
    asOfDate: Date,
    normalSide: 'Dr' | 'Cr',
    companyId?: string,
  ): Promise<Prisma.Decimal> {
    if (codePrefixes.length === 0) return new Prisma.Decimal(0);

    const orFilters = codePrefixes.map((p) => ({ accountCode: { startsWith: p } }));
    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        OR: orFilters,
        deletedAt: null,
        journalEntry: {
          status: 'POSTED',
          entryDate: { lte: asOfDate },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
      },
      _sum: { debit: true, credit: true },
    });

    let total = new Prisma.Decimal(0);
    for (const row of lineSums) {
      const dr = new Prisma.Decimal(row._sum.debit ?? 0);
      const cr = new Prisma.Decimal(row._sum.credit ?? 0);
      const delta = normalSide === 'Cr' ? cr.sub(dr) : dr.sub(cr);
      total = total.add(delta);
    }
    return total;
  }

  /**
   * Sum the period-only debit total for accounts matching the given prefixes.
   * Used for depreciation expense (Dr 53-16XX) where we want only Dr posted in the period,
   * not the running balance.
   */
  private async sumDebitInPeriod(
    codePrefixes: string[],
    periodStart: Date,
    periodEnd: Date,
    companyId?: string,
  ): Promise<Prisma.Decimal> {
    if (codePrefixes.length === 0) return new Prisma.Decimal(0);

    const orFilters = codePrefixes.map((p) => ({ accountCode: { startsWith: p } }));
    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        OR: orFilters,
        deletedAt: null,
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
      },
      _sum: { debit: true, credit: true },
    });

    let total = new Prisma.Decimal(0);
    for (const row of lineSums) {
      const dr = new Prisma.Decimal(row._sum.debit ?? 0);
      const cr = new Prisma.Decimal(row._sum.credit ?? 0);
      // Net debit posted in period: Dr - Cr (positive for expense buildup)
      total = total.add(dr.sub(cr));
    }
    return total;
  }

  /**
   * Cash Flow Statement — Indirect Method (TFRS for NPAEs).
   *
   * @param periodStart start of period (inclusive)
   * @param periodEnd   end of period (inclusive — caller should set 23:59:59.999 if needed)
   * @param companyId   optional CompanyInfo.id scope
   */
  async getCashFlowFromJournal(
    periodStart: Date,
    periodEnd: Date,
    companyId?: string,
  ) {
    const startMinusOne = new Date(periodStart);
    startMinusOne.setMilliseconds(startMinusOne.getMilliseconds() - 1);

    // 1. Net Income for the period
    // P3-SP5 W1: explicit 'FINANCE' scope — Cash Flow is FINANCE-only.
    const pl = await this.getProfitLossFromJournal(periodStart, periodEnd, companyId, 'FINANCE');
    const netIncome = pl.netIncome;

    // 2. Non-cash adjustments
    // Depreciation: Dr side of 53-16XX in the period
    const depreciation = await this.sumDebitInPeriod(['53-16'], periodStart, periodEnd, companyId);
    // Bad-debt provision change: Δ balance of 11-2102 (Cr-normal contra asset)
    const allowanceOpening = await this.sumAccountBalances(['11-2102'], startMinusOne, 'Cr', companyId);
    const allowanceClosing = await this.sumAccountBalances(['11-2102'], periodEnd, 'Cr', companyId);
    const badDebtProvisionChange = allowanceClosing.sub(allowanceOpening);
    // Unearned interest change: Δ balance of 11-2106 (Cr-normal contra asset)
    const unearnedOpening = await this.sumAccountBalances(['11-2106'], startMinusOne, 'Cr', companyId);
    const unearnedClosing = await this.sumAccountBalances(['11-2106'], periodEnd, 'Cr', companyId);
    const unearnedInterestChange = unearnedClosing.sub(unearnedOpening);

    // 3. Working capital changes
    // AR (Dr-normal): 11-2101 + 11-2103. Increase consumes cash → subtract change.
    const arOpening = await this.sumAccountBalances(['11-2101', '11-2103'], startMinusOne, 'Dr', companyId);
    const arClosing = await this.sumAccountBalances(['11-2101', '11-2103'], periodEnd, 'Dr', companyId);
    const arChange = arClosing.sub(arOpening); // positive = AR grew → cash OUT
    // Inventory (Dr-normal): 11-3XXX
    const invOpening = await this.sumAccountBalances(['11-3'], startMinusOne, 'Dr', companyId);
    const invClosing = await this.sumAccountBalances(['11-3'], periodEnd, 'Dr', companyId);
    const inventoryChange = invClosing.sub(invOpening); // positive = inventory grew → cash OUT
    // AP (Cr-normal): 21-1101 + 21-1102 + 21-31XX. Increase frees cash → add change.
    const apOpening = await this.sumAccountBalances(
      ['21-1101', '21-1102', '21-31'],
      startMinusOne,
      'Cr',
      companyId,
    );
    const apClosing = await this.sumAccountBalances(
      ['21-1101', '21-1102', '21-31'],
      periodEnd,
      'Cr',
      companyId,
    );
    const apChange = apClosing.sub(apOpening); // positive = AP grew → cash IN
    // VAT payable (Cr-normal): 21-2101 + 21-2102
    const vatOpening = await this.sumAccountBalances(
      ['21-2101', '21-2102'],
      startMinusOne,
      'Cr',
      companyId,
    );
    const vatClosing = await this.sumAccountBalances(
      ['21-2101', '21-2102'],
      periodEnd,
      'Cr',
      companyId,
    );
    const vatPayableChange = vatClosing.sub(vatOpening); // positive = VAT payable grew → cash IN

    // Net Operating = NI + non-cash − ΔAR − ΔInventory + ΔAP + ΔVAT
    // (depreciation, bad-debt provision, unearned interest are non-cash → add back)
    const netOperating = netIncome
      .add(depreciation)
      .add(badDebtProvisionChange)
      .add(unearnedInterestChange)
      .sub(arChange)
      .sub(inventoryChange)
      .add(apChange)
      .add(vatPayableChange);

    // 4. Investing
    // PPE purchases (cash OUT) — sum FixedAsset.purchaseCost where status=POSTED and
    // postedAt in period. We use postedAt (the date the cost JE was posted) rather
    // than purchaseDate to align with the cash effect — purchaseDate can lag well
    // behind the actual cash settlement in an accrual system.
    //
    // SP2 KNOWN GAP — FixedAsset has no companyId column, so passing `companyId`
    // filter has no effect on this aggregate. The number reflects ALL fixed
    // assets across both SHOP+FINANCE entities. Phase A.5 will add companyId
    // scoping on FixedAsset; until then we warn the caller.
    if (companyId) {
      this.logger.warn(
        `Cash Flow getCashFlowFromJournal called with companyId=${companyId} but ` +
          `FixedAsset lacks companyId. investing.ppePurchases will reflect company-wide PPE.`,
      );
    }
    const ppePurchasesAgg = await this.prisma.fixedAsset.aggregate({
      where: {
        status: 'POSTED',
        postedAt: { gte: periodStart, lte: periodEnd },
        deletedAt: null,
      },
      _sum: { purchaseCost: true },
    });
    const ppePurchases = new Prisma.Decimal(ppePurchasesAgg._sum.purchaseCost ?? 0);

    // PPE disposals (cash IN) — proceeds aren't a column on FixedAsset; they live in
    // JE metadata under flow='asset-disposal'. We aggregate disposalProceeds from the
    // metadata of POSTED disposal JEs whose entryDate falls in the period. This is
    // the authoritative source (template asset-disposal.template.ts writes it).
    const disposalEntries = await this.prisma.journalEntry.findMany({
      where: {
        status: 'POSTED',
        entryDate: { gte: periodStart, lte: periodEnd },
        deletedAt: null,
        ...(companyId ? { companyId } : {}),
        AND: [
          { metadata: { path: ['flow'], equals: 'asset-disposal' } } as Prisma.JournalEntryWhereInput,
        ],
      },
      select: { metadata: true },
    });
    let ppeDisposals = new Prisma.Decimal(0);
    for (const e of disposalEntries) {
      const meta = e.metadata as { disposalProceeds?: string | number } | null;
      if (meta && meta.disposalProceeds != null) {
        ppeDisposals = ppeDisposals.add(new Prisma.Decimal(meta.disposalProceeds.toString()));
      }
    }
    const netInvesting = ppeDisposals.sub(ppePurchases);

    // 5. Financing
    // Capital injections (Cr-normal): Δ (31-1101 + 31-1102)
    const capitalOpening = await this.sumAccountBalances(
      ['31-1101', '31-1102'],
      startMinusOne,
      'Cr',
      companyId,
    );
    const capitalClosing = await this.sumAccountBalances(
      ['31-1101', '31-1102'],
      periodEnd,
      'Cr',
      companyId,
    );
    const capitalInjections = capitalClosing.sub(capitalOpening); // positive = cash IN

    // Dividends: Δ 32-1101 (Cr-normal). Decrease = cash OUT. We expose the raw
    // delta — UI displays positive movements as injections (rare) and negative as
    // dividends. Without year-end closing entries the line is approximate.
    const dividendOpening = await this.sumAccountBalances(['32-1101'], startMinusOne, 'Cr', companyId);
    const dividendClosing = await this.sumAccountBalances(['32-1101'], periodEnd, 'Cr', companyId);
    const dividends = dividendOpening.sub(dividendClosing); // positive = paid out

    const netFinancing = capitalInjections.sub(dividends);

    const netChange = netOperating.add(netInvesting).add(netFinancing);

    // 6. Reconciliation: compare with raw cash account movement
    const CASH_PREFIXES = ['11-11', '11-12']; // 11-1101..11-1103 + 11-1201..11-1203
    const openingCash = await this.sumAccountBalances(CASH_PREFIXES, startMinusOne, 'Dr', companyId);
    const closingCash = await this.sumAccountBalances(CASH_PREFIXES, periodEnd, 'Dr', companyId);
    const actualCashChange = closingCash.sub(openingCash);
    const drift = netChange.sub(actualCashChange);
    const isReconciled = drift.abs().lte(new Prisma.Decimal(1));

    return {
      periodStart,
      periodEnd,
      method: 'indirect' as const,
      operating: {
        netIncome: netIncome.toNumber(),
        depreciation: depreciation.toNumber(),
        badDebtProvisionChange: badDebtProvisionChange.toNumber(),
        unearnedInterestChange: unearnedInterestChange.toNumber(),
        arChange: arChange.toNumber(),
        inventoryChange: inventoryChange.toNumber(),
        apChange: apChange.toNumber(),
        vatPayableChange: vatPayableChange.toNumber(),
        netOperating: netOperating.toNumber(),
      },
      investing: {
        ppePurchases: ppePurchases.toNumber(),
        ppeDisposals: ppeDisposals.toNumber(),
        netInvesting: netInvesting.toNumber(),
      },
      financing: {
        capitalInjections: capitalInjections.toNumber(),
        dividends: dividends.toNumber(),
        netFinancing: netFinancing.toNumber(),
      },
      netChange: netChange.toNumber(),
      openingCash: openingCash.toNumber(),
      closingCash: closingCash.toNumber(),
      actualCashChange: actualCashChange.toNumber(),
      isReconciled,
      drift: drift.toNumber(),
    };
  }

  // ─── SP2: Equity Statement ────────────────────────────────────────────────────
  //
  // Matrix of equity accounts (31-1101, 31-1102, 32-1101, 33-1101) showing
  // ยอดต้นงวด / +เพิ่ม / -ลด / ยอดปลายงวด with movement details.
  // The current-year P&L line is derived from getProfitLossFromJournal — labelled
  // with a caveat because year-end closing entries have not been posted to 33-1101.

  private static readonly EQUITY_ACCOUNTS: { code: string; defaultName: string }[] = [
    { code: '31-1101', defaultName: 'หุ้นสามัญ' },
    { code: '31-1102', defaultName: 'ส่วนเกินมูลค่าหุ้น' },
    { code: '32-1101', defaultName: 'กำไร(ขาดทุน)สะสม' },
    { code: '33-1101', defaultName: 'กำไร(ขาดทุน)สุทธิประจำปี' },
  ];

  async getEquityStatementFromJournal(
    periodStart: Date,
    periodEnd: Date,
    companyId?: string,
  ) {
    const codes = AccountingService.EQUITY_ACCOUNTS.map((a) => a.code);
    const startMinusOne = new Date(periodStart);
    startMinusOne.setMilliseconds(startMinusOne.getMilliseconds() - 1);

    // Load CoA names (may be missing if not seeded)
    const coa = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true, name: true },
    });
    const nameMap = new Map(coa.map((c) => [c.code, c.name]));

    // Load all journal lines that touched these accounts in the period
    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountCode: { in: codes },
        deletedAt: null,
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
      },
      select: {
        accountCode: true,
        debit: true,
        credit: true,
        description: true,
        journalEntry: {
          select: { entryDate: true, entryNumber: true, description: true },
        },
      },
      orderBy: { journalEntry: { entryDate: 'asc' } },
    });

    type Movement = { entryDate: Date; entryNumber: string; description: string; amount: number };
    const rows: Array<{
      accountCode: string;
      accountName: string;
      opening: number;
      increases: Movement[];
      decreases: Movement[];
      totalIncrease: number;
      totalDecrease: number;
      closing: number;
    }> = [];

    let totalOpening = new Prisma.Decimal(0);
    let totalClosing = new Prisma.Decimal(0);

    for (const accDef of AccountingService.EQUITY_ACCOUNTS) {
      // Opening balance (Cr-normal): credits - debits before periodStart
      const opening = await this.sumAccountBalances([accDef.code], startMinusOne, 'Cr', companyId);

      const increases: Movement[] = [];
      const decreases: Movement[] = [];
      let increaseTotal = new Prisma.Decimal(0);
      let decreaseTotal = new Prisma.Decimal(0);

      for (const line of lines) {
        if (line.accountCode !== accDef.code) continue;
        const dr = new Prisma.Decimal(line.debit);
        const cr = new Prisma.Decimal(line.credit);
        const movement: Omit<Movement, 'amount'> = {
          entryDate: line.journalEntry.entryDate,
          entryNumber: line.journalEntry.entryNumber,
          description: line.description ?? line.journalEntry.description,
        };
        // Equity is Cr-normal: Cr = increase, Dr = decrease.
        if (cr.gt(0)) {
          const amount = cr.toNumber();
          increases.push({ ...movement, amount });
          increaseTotal = increaseTotal.add(cr);
        }
        if (dr.gt(0)) {
          const amount = dr.toNumber();
          decreases.push({ ...movement, amount });
          decreaseTotal = decreaseTotal.add(dr);
        }
      }

      const closing = opening.add(increaseTotal).sub(decreaseTotal);

      rows.push({
        accountCode: accDef.code,
        accountName: nameMap.get(accDef.code) ?? accDef.defaultName,
        opening: opening.toNumber(),
        increases,
        decreases,
        totalIncrease: increaseTotal.toNumber(),
        totalDecrease: decreaseTotal.toNumber(),
        closing: closing.toNumber(),
      });

      totalOpening = totalOpening.add(opening);
      totalClosing = totalClosing.add(closing);
    }

    // Derive current-year P&L (yearStart .. periodEnd) for the caveat line.
    // This represents the implicit profit not yet closed into 33-1101.
    const yearStart = new Date(periodEnd.getFullYear(), 0, 1);
    // P3-SP5 W1: explicit 'FINANCE' scope — Equity Statement is FINANCE-only.
    const yearPL = await this.getProfitLossFromJournal(yearStart, periodEnd, companyId, 'FINANCE');
    const currentYearProfit = yearPL.netIncome.toNumber();

    return {
      periodStart,
      periodEnd,
      rows,
      currentYearProfit,
      caveat:
        'ค่าประมาณกำไรปีปัจจุบัน — ยังไม่ปิดบัญชีจริงเข้า 33-1101 / 32-1101 (รอปิดบัญชีสิ้นปี)',
      totalOpening: totalOpening.toNumber(),
      totalClosing: totalClosing.toNumber(),
    };
  }

  // ─── SP2: General Ledger ──────────────────────────────────────────────────────

  /**
   * General Ledger for a single account over a period.
   * Returns opening balance, every posted journal line, and running balance.
   *
   * Running balance is signed on the normal side:
   *   - Dr-normal account: balance = Σ(debit - credit)
   *   - Cr-normal account: balance = Σ(credit - debit)
   *   - Dr/Cr account: treated as Dr-normal for display purposes.
   */
  async getGeneralLedger(
    accountCode: string,
    periodStart: Date,
    periodEnd: Date,
    companyId?: string,
  ) {
    const account = await this.prisma.chartOfAccount.findFirst({
      where: { code: accountCode, deletedAt: null },
      select: { code: true, name: true, normalBalance: true },
    });
    if (!account) {
      throw new NotFoundException(`ไม่พบรหัสบัญชี ${accountCode} ในผังบัญชี`);
    }

    const normalBalance = account.normalBalance as 'Dr' | 'Cr' | 'Dr/Cr';
    const startMinusOne = new Date(periodStart);
    startMinusOne.setMilliseconds(startMinusOne.getMilliseconds() - 1);

    // Opening balance (everything before periodStart)
    const opening = await this.sumAccountBalances(
      [accountCode],
      startMinusOne,
      normalBalance === 'Cr' ? 'Cr' : 'Dr',
      companyId,
    );

    // All journal lines in the period
    const rawLines = await this.prisma.journalLine.findMany({
      where: {
        accountCode,
        deletedAt: null,
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
      },
      select: {
        debit: true,
        credit: true,
        description: true,
        journalEntry: {
          select: {
            entryDate: true,
            entryNumber: true,
            description: true,
            referenceType: true,
            referenceId: true,
          },
        },
      },
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { journalEntry: { entryNumber: 'asc' } }],
    });

    let running = new Prisma.Decimal(opening);
    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);

    const lines = rawLines.map((line) => {
      const dr = new Prisma.Decimal(line.debit);
      const cr = new Prisma.Decimal(line.credit);
      // Running balance on normal side
      const delta = normalBalance === 'Cr' ? cr.sub(dr) : dr.sub(cr);
      running = running.add(delta);
      totalDebit = totalDebit.add(dr);
      totalCredit = totalCredit.add(cr);

      return {
        entryDate: line.journalEntry.entryDate,
        entryNumber: line.journalEntry.entryNumber,
        description: line.description ?? line.journalEntry.description,
        referenceType: line.journalEntry.referenceType,
        referenceId: line.journalEntry.referenceId,
        debit: dr.toNumber(),
        credit: cr.toNumber(),
        runningBalance: running.toNumber(),
      };
    });

    return {
      accountCode: account.code,
      accountName: account.name,
      normalBalance,
      periodStart,
      periodEnd,
      opening: opening.toNumber(),
      closing: running.toNumber(),
      totalDebit: totalDebit.toNumber(),
      totalCredit: totalCredit.toNumber(),
      lines,
    };
  }

  // ============================================================
  // P3-SP3: PEAK CSV export (journal lines tagged with PEAK code)
  // ============================================================

  /**
   * Build a CSV of POSTED journal lines within `[periodStart, periodEnd]`
   * joined with their `ChartOfAccount.peakCode`. Lines whose account has no
   * PEAK mapping are SKIPPED (returned `skippedLineCount`) so the caller can
   * surface a warning. Date range is capped at ~6 months (186 days) so accidental
   * "give me everything" queries don't dump millions of rows.
   *
   * Output columns:
   *   entryDate, entryNumber, peakCode, accountCode, accountName,
   *   debit, credit, description, reference
   *
   * Money values are emitted via `.toString()` to preserve Decimal precision
   * (matches the "DO NOT Number() on Prisma.Decimal in export" rule).
   */
  async exportJournalWithPeakCodes(
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ csv: string; rowCount: number; skippedLineCount: number }> {
    // Guard: max 186 days (~6 months) per spec — protects DB + filesystem.
    const ms = periodEnd.getTime() - periodStart.getTime();
    const MAX_DAYS = 186;
    if (ms < 0) {
      throw new BadRequestException('วันที่สิ้นสุดต้องไม่อยู่ก่อนวันเริ่มต้น');
    }
    if (ms > MAX_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('ช่วงเวลาส่งออกต้องไม่เกิน 6 เดือนต่อครั้ง');
    }

    // 1) Build a peakCode lookup for every account that has one. Single query
    //    is cheaper than joining inline because there are ~99 accounts total.
    const mappedAccounts = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null, peakCode: { not: null } },
      select: { code: true, name: true, peakCode: true },
    });
    const peakByCode = new Map(
      mappedAccounts.map((a) => [a.code, { name: a.name, peakCode: a.peakCode! }]),
    );

    // Also load account names for un-mapped lines so we can report what was skipped.
    const allAccounts = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null },
      select: { code: true, name: true },
    });
    const nameByCode = new Map(allAccounts.map((a) => [a.code, a.name]));

    // 2) Fetch journal lines in range. Order by entryDate then entryNumber so
    //    the CSV is deterministic for reconciliation diffs.
    const lines = await this.prisma.journalLine.findMany({
      where: {
        deletedAt: null,
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
        },
      },
      select: {
        accountCode: true,
        debit: true,
        credit: true,
        description: true,
        journalEntry: {
          select: {
            entryNumber: true,
            entryDate: true,
            description: true,
            referenceType: true,
            referenceId: true,
          },
        },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { journalEntry: { entryNumber: 'asc' } },
      ],
    });

    // 3) Render rows; skip un-mapped accounts.
    const escape = (v: string | null | undefined) => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const header = [
      'entryDate',
      'entryNumber',
      'peakCode',
      'accountCode',
      'accountName',
      'debit',
      'credit',
      'description',
      'reference',
    ].join(',');

    const body: string[] = [];
    let skipped = 0;
    for (const ln of lines) {
      const mapping = peakByCode.get(ln.accountCode);
      if (!mapping) {
        skipped++;
        continue;
      }
      const ref = ln.journalEntry.referenceType
        ? `${ln.journalEntry.referenceType}:${ln.journalEntry.referenceId ?? ''}`
        : '';
      body.push(
        [
          ln.journalEntry.entryDate.toISOString().slice(0, 10),
          escape(ln.journalEntry.entryNumber),
          escape(mapping.peakCode),
          escape(ln.accountCode),
          escape(nameByCode.get(ln.accountCode) ?? mapping.name),
          // String form keeps full Decimal precision — never Number()
          new Prisma.Decimal(ln.debit).toString(),
          new Prisma.Decimal(ln.credit).toString(),
          escape(ln.description ?? ln.journalEntry.description),
          escape(ref),
        ].join(','),
      );
    }

    return {
      // UTF-8 BOM so Excel renders Thai correctly.
      csv: '﻿' + [header, ...body].join('\n'),
      rowCount: body.length,
      skippedLineCount: skipped,
    };
  }

  // ─── General Journal ──────────────────────────────────────────────────────

  /**
   * Returns a paginated list of JournalEntries within the given date range,
   * ordered by postedAt descending, with their lines included.
   *
   * Used by the GeneralJournalPage (P4-SP1, Task 7).
   */
  async getGeneralJournal(
    periodStart: Date,
    periodEnd: Date,
    opts: { page?: number; limit?: number; companyId?: string } = {},
  ) {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const where = {
      postedAt: { gte: periodStart, lte: periodEnd },
      deletedAt: null,
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          lines: {
            select: {
              accountCode: true,
              debit: true,
              credit: true,
              description: true,
            },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { postedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  // ─── P4-SP1: Aging Report ────────────────────────────────────────────────

  async getAgingReport(asOf: Date) {
    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { lt: asOf },
        deletedAt: null,
      },
      include: {
        contract: {
          include: {
            customer: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
      },
    });

    const summary = {
      bucket_0_30: 0,
      bucket_31_60: 0,
      bucket_61_90: 0,
      bucket_90_plus: 0,
    };

    const customerMap = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        phone: string;
        totalOverdue: number;
        daysOverdue: number;
        bucket: string;
        contracts: number;
      }
    >();

    const calcBucket = (days: number): keyof typeof summary => {
      if (days <= 30) return 'bucket_0_30';
      if (days <= 60) return 'bucket_31_60';
      if (days <= 90) return 'bucket_61_90';
      return 'bucket_90_plus';
    };

    for (const p of overduePayments) {
      const daysOverdue = Math.floor(
        (asOf.getTime() - p.dueDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const remaining = Number(p.amountDue) - Number(p.amountPaid ?? 0);
      if (remaining <= 0) continue;

      const bucket = calcBucket(daysOverdue);
      summary[bucket] += remaining;

      const cid = p.contract.customer.id;
      const existing = customerMap.get(cid);
      if (existing) {
        existing.totalOverdue += remaining;
        existing.daysOverdue = Math.max(existing.daysOverdue, daysOverdue);
        existing.bucket = calcBucket(existing.daysOverdue);
      } else {
        customerMap.set(cid, {
          customerId: cid,
          customerName: p.contract.customer.name,
          phone: p.contract.customer.phone ?? '',
          totalOverdue: remaining,
          daysOverdue,
          bucket,
          contracts: 1,
        });
      }
    }

    return {
      asOf,
      summary,
      customers: Array.from(customerMap.values()).sort(
        (a, b) => b.daysOverdue - a.daysOverdue,
      ),
    };
  }

  // ─── P4-SP1 Task 3: Bad Debt Report ─────────────────────────────────────────

  /**
   * Returns journal lines posted to account 51-1102 (หนี้สูญ/ขาดทุนจากยึดเครื่อง)
   * within the given period. Used by BadDebtReportPage to display write-off history.
   *
   * Per .claude/rules/accounting.md:
   *   51-1102 = หนี้สูญ/ขาดทุนจากยึดเครื่อง (RepossessionJP5Template loss branch)
   */
  async getBadDebtReport(periodStart: Date, periodEnd: Date, companyId?: string) {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountCode: '51-1102',
        journalEntry: {
          postedAt: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
      },
      include: {
        journalEntry: {
          select: {
            id: true,
            entryNumber: true,
            description: true,
            postedAt: true,
            referenceType: true,
            referenceId: true,
          },
        },
      },
      orderBy: { journalEntry: { postedAt: 'desc' } },
    });

    const total = lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0);

    return {
      period: { start: periodStart, end: periodEnd },
      totalBadDebt: total,
      entries: lines.map((l) => ({
        journalEntryId: l.journalEntry.id,
        documentNumber: l.journalEntry.entryNumber,
        postedAt: l.journalEntry.postedAt,
        description: l.description ?? l.journalEntry.description,
        amount: Number(l.debit ?? 0),
        sourceType: l.journalEntry.referenceType,
        sourceId: l.journalEntry.referenceId,
      })),
    };
  }
}
