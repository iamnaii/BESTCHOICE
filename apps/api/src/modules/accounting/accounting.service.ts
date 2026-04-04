import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpenseAccountType, ExpenseCategory, ExpenseStatus, Prisma } from '@prisma/client';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

// Map category → accountType for validation
const CATEGORY_ACCOUNT_MAP: Record<string, ExpenseAccountType> = {
  COGS_PRODUCT: 'COST_OF_SALES',
  COGS_REPAIR_PARTS: 'COST_OF_SALES',
  SELL_COMMISSION: 'SELLING_EXPENSE',
  SELL_ADVERTISING: 'SELLING_EXPENSE',
  SELL_TRANSPORT: 'SELLING_EXPENSE',
  SELL_PACKAGING: 'SELLING_EXPENSE',
  ADMIN_SALARY: 'ADMINISTRATIVE_EXPENSE',
  ADMIN_SOCIAL_SECURITY: 'ADMINISTRATIVE_EXPENSE',
  ADMIN_RENT: 'ADMINISTRATIVE_EXPENSE',
  ADMIN_UTILITIES: 'ADMINISTRATIVE_EXPENSE',
  ADMIN_OFFICE_SUPPLIES: 'ADMINISTRATIVE_EXPENSE',
  ADMIN_DEPRECIATION: 'ADMINISTRATIVE_EXPENSE',
  ADMIN_INSURANCE: 'ADMINISTRATIVE_EXPENSE',
  ADMIN_TAX_FEE: 'ADMINISTRATIVE_EXPENSE',
  ADMIN_MAINTENANCE: 'ADMINISTRATIVE_EXPENSE',
  ADMIN_TRAVEL: 'ADMINISTRATIVE_EXPENSE',
  ADMIN_TELEPHONE: 'ADMINISTRATIVE_EXPENSE',
  OTHER_INTEREST: 'OTHER_EXPENSE',
  OTHER_LOSS: 'OTHER_EXPENSE',
  OTHER_FINE: 'OTHER_EXPENSE',
  OTHER_MISC: 'OTHER_EXPENSE',
};

// Map category → account code
const CATEGORY_CODE_MAP: Record<string, string> = {
  COGS_PRODUCT: '5101', COGS_REPAIR_PARTS: '5102',
  SELL_COMMISSION: '5201', SELL_ADVERTISING: '5202', SELL_TRANSPORT: '5203', SELL_PACKAGING: '5204',
  ADMIN_SALARY: '5301', ADMIN_SOCIAL_SECURITY: '5302', ADMIN_RENT: '5303', ADMIN_UTILITIES: '5304',
  ADMIN_OFFICE_SUPPLIES: '5305', ADMIN_DEPRECIATION: '5306', ADMIN_INSURANCE: '5307',
  ADMIN_TAX_FEE: '5308', ADMIN_MAINTENANCE: '5309', ADMIN_TRAVEL: '5310', ADMIN_TELEPHONE: '5311',
  OTHER_INTEREST: '5901', OTHER_LOSS: '5902', OTHER_FINE: '5903', OTHER_MISC: '5999',
};

async function generateExpenseNumber(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `EXP-${ym}-`;
  const last = await tx.expense.findFirst({
    where: { expenseNumber: { startsWith: prefix } },
    orderBy: { expenseNumber: 'desc' },
    select: { expenseNumber: true },
  });
  const seq = last ? parseInt(last.expenseNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

@Injectable()
export class AccountingService {
  constructor(private prisma: PrismaService) {}

  // ─── Expenses CRUD ───────────────────────────────────────────────────────────

  async createExpense(dto: CreateExpenseDto, createdById: string) {
    const expectedAccountType = CATEGORY_ACCOUNT_MAP[dto.category];
    if (expectedAccountType && expectedAccountType !== dto.accountType) {
      throw new BadRequestException(
        `หมวดย่อย ${dto.category} ต้องอยู่ในหมวดหลัก ${expectedAccountType}`,
      );
    }

    let vatAmount = dto.vatAmount || 0;
    if (dto.includeVat && !dto.vatAmount) {
      const vatConfig = await this.prisma.systemConfig.findUnique({ where: { key: 'vat_pct' } });
      const vatRate = vatConfig ? Number(vatConfig.value) : 0.07;
      vatAmount = Math.round(dto.amount * vatRate * 100) / 100;
    }
    const withholdingTax = dto.withholdingTax || 0;
    const totalAmount = dto.amount + vatAmount;
    const accountCode = dto.accountCode || CATEGORY_CODE_MAP[dto.category] || null;

    return this.prisma.$transaction(async (tx) => {
      const expenseNumber = await generateExpenseNumber(tx);

      return tx.expense.create({
        data: {
          expenseNumber,
          branchId: dto.branchId,
          accountType: dto.accountType,
          category: dto.category,
          accountCode,
          description: dto.description,
          amount: dto.amount,
          vatAmount,
          totalAmount,
          withholdingTax,
          expenseDate: new Date(dto.expenseDate),
          paymentMethod: dto.paymentMethod,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : null,
          reference: dto.reference,
          vendorName: dto.vendorName,
          vendorTaxId: dto.vendorTaxId,
          receiptImageUrl: dto.receiptImageUrl,
          taxInvoiceNo: dto.taxInvoiceNo,
          isRecurring: dto.isRecurring || false,
          recurringDay: dto.recurringDay,
          note: dto.note,
          createdById,
        },
        include: {
          branch: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });
    });
  }

  async findAllExpenses(filters: {
    branchId?: string;
    accountType?: ExpenseAccountType;
    category?: ExpenseCategory;
    status?: ExpenseStatus;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const { branchId, accountType, category, status, search, startDate, endDate, page = 1, limit = 20 } = filters;
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    const where: Prisma.ExpenseWhereInput = { deletedAt: null };
    if (branchId) where.branchId = branchId;
    if (accountType) where.accountType = accountType;
    if (category) where.category = category;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate) where.expenseDate.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.expenseDate.lte = end;
      }
    }
    if (search) {
      where.OR = [
        { expenseNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { vendorName: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
        },
        orderBy: { expenseDate: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return { data, total, page: safePage, limit: safeLimit };
  }

  async findOneExpense(id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, deletedAt: null },
      include: {
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    return expense;
  }

  async updateExpense(id: string, dto: UpdateExpenseDto) {
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status === 'APPROVED' || expense.status === 'PAID') {
      throw new BadRequestException('ไม่สามารถแก้ไขรายจ่ายที่อนุมัติหรือจ่ายแล้ว');
    }

    const data: Prisma.ExpenseUpdateInput = {};
    if (dto.accountType !== undefined) data.accountType = dto.accountType;
    if (dto.category !== undefined) {
      data.category = dto.category;
      data.accountCode = CATEGORY_CODE_MAP[dto.category] || expense.accountCode;
    }
    if (dto.accountCode !== undefined) data.accountCode = dto.accountCode;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.expenseDate !== undefined) data.expenseDate = new Date(dto.expenseDate);
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
    if (dto.paymentDate !== undefined) data.paymentDate = new Date(dto.paymentDate);
    if (dto.reference !== undefined) data.reference = dto.reference;
    if (dto.vendorName !== undefined) data.vendorName = dto.vendorName;
    if (dto.vendorTaxId !== undefined) data.vendorTaxId = dto.vendorTaxId;
    if (dto.receiptImageUrl !== undefined) data.receiptImageUrl = dto.receiptImageUrl;
    if (dto.taxInvoiceNo !== undefined) data.taxInvoiceNo = dto.taxInvoiceNo;
    if (dto.note !== undefined) data.note = dto.note;

    const amount = dto.amount ?? Number(expense.amount);
    const vatAmount = dto.vatAmount ?? Number(expense.vatAmount);
    const withholdingTax = dto.withholdingTax ?? Number(expense.withholdingTax);
    if (dto.amount !== undefined || dto.vatAmount !== undefined || dto.withholdingTax !== undefined) {
      data.amount = amount;
      data.vatAmount = vatAmount;
      data.totalAmount = amount + vatAmount;
      data.withholdingTax = withholdingTax;
    }

    return this.prisma.expense.update({
      where: { id },
      data,
      include: {
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async submitExpenseForApproval(id: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status !== 'DRAFT' && expense.status !== 'REJECTED') {
      throw new BadRequestException('สถานะปัจจุบันไม่สามารถส่งอนุมัติได้');
    }
    return this.prisma.expense.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
  }

  async approveExpense(id: string, approvedById: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('รายจ่ายนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
    }
    return this.prisma.expense.update({
      where: { id },
      data: { status: 'APPROVED', approvedById, approvedAt: new Date() },
    });
  }

  async rejectExpense(id: string, approvedById: string, reason: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('รายจ่ายนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
    }
    return this.prisma.expense.update({
      where: { id },
      data: { status: 'REJECTED', approvedById, approvedAt: new Date(), rejectReason: reason },
    });
  }

  async markExpensePaid(id: string, paymentDate?: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status !== 'APPROVED') {
      throw new BadRequestException('ต้องอนุมัติก่อนถึงจะบันทึกจ่ายได้');
    }
    return this.prisma.expense.update({
      where: { id },
      data: { status: 'PAID', paymentDate: paymentDate ? new Date(paymentDate) : new Date() },
    });
  }

  async voidExpense(id: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status === 'VOIDED') {
      throw new BadRequestException('รายจ่ายนี้ถูกยกเลิกไปแล้ว');
    }
    return this.prisma.expense.update({ where: { id }, data: { status: 'VOIDED' } });
  }

  async getExpenseSummary(filters: { branchId?: string; startDate?: string; endDate?: string }) {
    const where: Prisma.ExpenseWhereInput = { deletedAt: null, status: { notIn: ['VOIDED', 'REJECTED'] } };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.startDate || filters.endDate) {
      where.expenseDate = {};
      if (filters.startDate) where.expenseDate.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        where.expenseDate.lte = end;
      }
    }

    const expenses = await this.prisma.expense.findMany({
      where,
      select: { accountType: true, category: true, totalAmount: true, status: true },
    });

    const byAccountType: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let totalAmount = 0;
    let pendingCount = 0;

    for (const e of expenses) {
      const amt = Number(e.totalAmount);
      totalAmount += amt;
      byAccountType[e.accountType] = (byAccountType[e.accountType] || 0) + amt;
      byCategory[e.category] = (byCategory[e.category] || 0) + amt;
      if (e.status === 'PENDING_APPROVAL' || e.status === 'DRAFT') pendingCount++;
    }

    return { totalAmount, totalCount: expenses.length, pendingCount, byAccountType, byCategory };
  }

  async getExpenseCategoryBreakdown(filters: { branchId?: string; startDate?: string; endDate?: string }) {
    const where: Prisma.ExpenseWhereInput = { deletedAt: null, status: { notIn: ['VOIDED', 'REJECTED'] } };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.startDate || filters.endDate) {
      where.expenseDate = {};
      if (filters.startDate) where.expenseDate.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        where.expenseDate.lte = end;
      }
    }

    const expenses = await this.prisma.expense.findMany({
      where,
      select: { accountType: true, category: true, totalAmount: true, accountCode: true },
    });

    const breakdown: Record<string, { accountType: string; accountCode: string | null; total: number; count: number }> = {};
    for (const e of expenses) {
      if (!breakdown[e.category]) {
        breakdown[e.category] = { accountType: e.accountType, accountCode: e.accountCode, total: 0, count: 0 };
      }
      breakdown[e.category].total += Number(e.totalAmount);
      breakdown[e.category].count++;
    }

    return Object.entries(breakdown)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''));
  }

  // ─── P&L Calculation ─────────────────────────────────────────────────────────

  async getProfitLossReport(startDate: string, endDate: string, branchId?: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const branchFilter = branchId ? { branchId } : {};
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
        where: { saleType: 'CASH', createdAt: dateRange, ...branchFilter },
        _sum: { netAmount: true },
      }),
      this.prisma.sale.aggregate({
        where: { saleType: 'INSTALLMENT', createdAt: dateRange, ...branchFilter },
        _sum: { downPaymentAmount: true },
      }),
      this.prisma.sale.aggregate({
        where: { saleType: 'EXTERNAL_FINANCE', createdAt: dateRange, ...branchFilter },
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
          contract: { select: { interestTotal: true, totalMonths: true } },
        },
      }),
      this.prisma.financeReceivable.aggregate({
        where: { status: 'RECEIVED', receivedDate: dateRange, ...branchFilter },
        _sum: { receivedAmount: true },
      }),
      this.prisma.expense.findMany({
        where: {
          expenseDate: dateRange,
          status: { in: ['PAID', 'APPROVED'] },
          deletedAt: null,
          ...branchFilter,
        },
        select: { category: true, totalAmount: true },
      }),
      this.prisma.sale.findMany({
        where: { createdAt: dateRange, ...branchFilter },
        select: { product: { select: { costPrice: true } } },
      }),
    ]);

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

    const expMap: Record<string, number> = {};
    for (const e of expensesByCategory) {
      expMap[e.category] = (expMap[e.category] || 0) + Number(e.totalAmount);
    }

    const purchaseOrderCost = productCosts.reduce((sum, s) => sum + Number(s.product.costPrice || 0), 0);

    const costOfSales = {
      cogsProduct: expMap['COGS_PRODUCT'] || 0,
      cogsRepairParts: expMap['COGS_REPAIR_PARTS'] || 0,
      purchaseOrderCost,
      totalCOGS: (expMap['COGS_PRODUCT'] || 0) + (expMap['COGS_REPAIR_PARTS'] || 0) + purchaseOrderCost,
    };

    const grossProfit = totalRevenue - costOfSales.totalCOGS;

    const sellingExpenses = {
      commission: expMap['SELL_COMMISSION'] || 0,
      advertising: expMap['SELL_ADVERTISING'] || 0,
      transport: expMap['SELL_TRANSPORT'] || 0,
      packaging: expMap['SELL_PACKAGING'] || 0,
      totalSelling: (expMap['SELL_COMMISSION'] || 0) + (expMap['SELL_ADVERTISING'] || 0)
        + (expMap['SELL_TRANSPORT'] || 0) + (expMap['SELL_PACKAGING'] || 0),
    };

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

  async getMonthlyPLSummary(year: number, branchId?: string) {
    const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
    const branchFilter = branchId ? { branchId } : {};
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
          contract: { select: { interestTotal: true, totalMonths: true } },
        },
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

    const months = Array.from({ length: 12 }, (_, i) => {
      let revenue = 0;
      let cogs = 0;
      let expenseTotal = 0;

      for (const s of sales) {
        if (getMonth(s.createdAt) !== i) continue;
        if (s.saleType === 'CASH') revenue += Number(s.netAmount);
        if (s.saleType === 'INSTALLMENT' || s.saleType === 'EXTERNAL_FINANCE') {
          revenue += Number(s.downPaymentAmount || 0);
        }
      }

      for (const p of payments) {
        if (getMonth(p.paidDate) !== i) continue;
        revenue += Number(p.amountPaid);
        if (!p.lateFeeWaived) revenue += Number(p.lateFee);
      }

      for (const f of financeRecs) {
        if (getMonth(f.receivedDate) !== i) continue;
        revenue += Number(f.receivedAmount || 0);
      }

      for (const s of productSales) {
        if (getMonth(s.createdAt) !== i) continue;
        cogs += Number(s.product.costPrice || 0);
      }

      for (const e of expenses) {
        if (getMonth(e.expenseDate) !== i) continue;
        expenseTotal += Number(e.totalAmount);
      }

      const totalExpenses = cogs + expenseTotal;
      return { month: i + 1, label: thaiMonths[i], revenue, expenses: totalExpenses, netProfit: revenue - totalExpenses };
    });

    return { year, months };
  }
}
