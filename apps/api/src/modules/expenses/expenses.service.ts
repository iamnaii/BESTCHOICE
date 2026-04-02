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
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateExpenseDto, createdById: string) {
    // Validate category matches accountType
    const expectedAccountType = CATEGORY_ACCOUNT_MAP[dto.category];
    if (expectedAccountType && expectedAccountType !== dto.accountType) {
      throw new BadRequestException(
        `หมวดย่อย ${dto.category} ต้องอยู่ในหมวดหลัก ${expectedAccountType}`,
      );
    }

    const vatAmount = dto.vatAmount || 0;
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

  async findAll(filters: {
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

  async findOne(id: string) {
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

  async update(id: string, dto: UpdateExpenseDto) {
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

    // Recalculate totals if amount or VAT changed
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

  async submitForApproval(id: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status !== 'DRAFT' && expense.status !== 'REJECTED') {
      throw new BadRequestException('สถานะปัจจุบันไม่สามารถส่งอนุมัติได้');
    }

    return this.prisma.expense.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });
  }

  async approve(id: string, approvedById: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('รายจ่ายนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
    }

    return this.prisma.expense.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById,
        approvedAt: new Date(),
      },
    });
  }

  async reject(id: string, approvedById: string, reason: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('รายจ่ายนี้ไม่ได้อยู่ในสถานะรออนุมัติ');
    }

    return this.prisma.expense.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedById,
        approvedAt: new Date(),
        rejectReason: reason,
      },
    });
  }

  async markPaid(id: string, paymentDate?: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status !== 'APPROVED') {
      throw new BadRequestException('ต้องอนุมัติก่อนถึงจะบันทึกจ่ายได้');
    }

    return this.prisma.expense.update({
      where: { id },
      data: {
        status: 'PAID',
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      },
    });
  }

  async void(id: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status === 'VOIDED') {
      throw new BadRequestException('รายจ่ายนี้ถูกยกเลิกไปแล้ว');
    }

    return this.prisma.expense.update({
      where: { id },
      data: { status: 'VOIDED' },
    });
  }

  async getSummary(filters: { branchId?: string; startDate?: string; endDate?: string }) {
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
}
