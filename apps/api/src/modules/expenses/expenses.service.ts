import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, ExpenseCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENT: 'ค่าเช่า',
  UTILITIES: 'ค่าน้ำค่าไฟ',
  SALARY: 'เงินเดือน',
  COMMISSION: 'ค่าคอมมิชชั่น',
  TRANSPORTATION: 'ค่าขนส่ง',
  OFFICE_SUPPLIES: 'วัสดุสำนักงาน',
  MARKETING: 'ค่าการตลาด',
  INSURANCE: 'ค่าประกัน',
  MAINTENANCE: 'ค่าบำรุงรักษา',
  TAXES: 'ภาษี',
  INTERNET: 'ค่าอินเทอร์เน็ต',
  PHONE_BILL: 'ค่าโทรศัพท์',
  MISCELLANEOUS: 'ค่าใช้จ่ายเบ็ดเตล็ด',
  OTHER: 'อื่นๆ',
};

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    search?: string,
    page = 1,
    limit = 50,
    branchId?: string,
    category?: ExpenseCategory,
    month?: number,
    year?: number,
  ) {
    const where: Prisma.ExpenseWhereInput = { deletedAt: null };

    if (search) {
      where.OR = [
        { expenseNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (branchId) where.branchId = branchId;
    if (category) where.category = category;
    if (month) where.month = month;
    if (year) where.year = year;

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        include: {
          branch: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { expenseDate: 'desc' },
      }),
      this.prisma.expense.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, deletedAt: null },
      include: {
        branch: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!expense) throw new NotFoundException('ไม่พบรายการค่าใช้จ่าย');
    return expense;
  }

  async create(dto: CreateExpenseDto, userId: string) {
    if (dto.category === 'OTHER' && !dto.customCategory) {
      throw new BadRequestException('กรุณาระบุหมวดค่าใช้จ่ายเมื่อเลือก "อื่นๆ"');
    }

    const date = new Date(dto.expenseDate);
    const month = date.getMonth() + 1;
    const year = date.getFullYear();

    // Generate sequential expense number: EXP-YYYY-MM-NNN
    const prefix = `EXP-${year}-${String(month).padStart(2, '0')}`;
    const lastExpense = await this.prisma.expense.findFirst({
      where: { expenseNumber: { startsWith: prefix } },
      orderBy: { expenseNumber: 'desc' },
    });

    let seq = 1;
    if (lastExpense) {
      const lastSeq = parseInt(lastExpense.expenseNumber.split('-').pop() || '0');
      seq = lastSeq + 1;
    }
    const expenseNumber = `${prefix}-${String(seq).padStart(3, '0')}`;

    return this.prisma.expense.create({
      data: {
        expenseNumber,
        branchId: dto.branchId,
        category: dto.category,
        customCategory: dto.customCategory,
        description: dto.description,
        amount: new Prisma.Decimal(dto.amount),
        expenseDate: date,
        month,
        year,
        paymentMethod: dto.paymentMethod,
        referenceNumber: dto.referenceNumber,
        evidenceUrls: dto.evidenceUrls || [],
        notes: dto.notes,
        isRecurring: dto.isRecurring || false,
        createdById: userId,
      },
      include: {
        branch: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });
  }

  async update(id: string, dto: UpdateExpenseDto) {
    await this.findOne(id);
    const data: Prisma.ExpenseUpdateInput = {};

    if (dto.branchId) data.branch = { connect: { id: dto.branchId } };
    if (dto.category) data.category = dto.category;
    if (dto.customCategory !== undefined) data.customCategory = dto.customCategory;
    if (dto.description) data.description = dto.description;
    if (dto.amount) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.expenseDate) {
      const date = new Date(dto.expenseDate);
      data.expenseDate = date;
      data.month = date.getMonth() + 1;
      data.year = date.getFullYear();
    }
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
    if (dto.referenceNumber !== undefined) data.referenceNumber = dto.referenceNumber;
    if (dto.evidenceUrls) data.evidenceUrls = dto.evidenceUrls;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.isRecurring !== undefined) data.isRecurring = dto.isRecurring;

    return this.prisma.expense.update({
      where: { id },
      data,
      include: {
        branch: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });
  }

  async delete(id: string) {
    await this.findOne(id);
    return this.prisma.expense.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async getSummary(month?: number, year?: number, branchId?: string) {
    const now = new Date();
    const targetMonth = month || now.getMonth() + 1;
    const targetYear = year || now.getFullYear();

    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      month: targetMonth,
      year: targetYear,
    };
    if (branchId) where.branchId = branchId;

    const expenses = await this.prisma.expense.groupBy({
      by: ['category'],
      where,
      _sum: { amount: true },
      _count: true,
    });

    const total = expenses.reduce(
      (sum, e) => sum.add(e._sum.amount || new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );

    const categories = expenses.map((e) => ({
      category: e.category,
      label: CATEGORY_LABELS[e.category],
      amount: e._sum.amount || new Prisma.Decimal(0),
      count: e._count,
      percentage: total.gt(0)
        ? (e._sum.amount || new Prisma.Decimal(0)).div(total).mul(100).toNumber()
        : 0,
    }));

    categories.sort((a, b) => b.amount.comparedTo(a.amount));

    return {
      month: targetMonth,
      year: targetYear,
      total,
      itemCount: expenses.reduce((sum, e) => sum + e._count, 0),
      categories,
    };
  }

  async getMonthlyComparison(branchId?: string) {
    const now = new Date();
    const months: { month: number; year: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ month: d.getMonth() + 1, year: d.getFullYear() });
    }

    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      OR: months.map((m) => ({ month: m.month, year: m.year })),
    };
    if (branchId) where.branchId = branchId;

    const expenses = await this.prisma.expense.groupBy({
      by: ['month', 'year', 'category'],
      where,
      _sum: { amount: true },
    });

    const result = months.map((m) => {
      const monthExpenses = expenses.filter(
        (e) => e.month === m.month && e.year === m.year,
      );
      const categories: Record<string, number> = {};
      let total = 0;

      for (const e of monthExpenses) {
        const amount = (e._sum.amount || new Prisma.Decimal(0)).toNumber();
        categories[e.category] = amount;
        total += amount;
      }

      return { month: m.month, year: m.year, total, categories };
    });

    return result;
  }
}
