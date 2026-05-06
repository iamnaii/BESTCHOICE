import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StructuredLoggerService } from '../../common/logger';
import { ExpenseAccountType, ExpenseStatus, Prisma, WhtIncomeType } from '@prisma/client';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';
import { validatePeriodOpen as validatePeriodOpenUtil } from '../../utils/period-lock.util';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ExpenseTemplate } from '../journal/cpa-templates/expense.template';
import { d, dAdd, dSub, dMul, dRound } from '../../utils/decimal.util';

/**
 * INVENTORY COSTING METHOD: Specific Identification
 * Each product has a unique costPrice (IMEI-level tracking).
 * COGS is calculated as the specific costPrice of the sold product.
 * This is compliant with TAS 2 for items that are not interchangeable.
 */
export const INVENTORY_COSTING_METHOD = 'SPECIFIC_IDENTIFICATION' as const;

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

// Map category → account code (PEAK format XX-XXXX)
// Phase A.6: audited against 105-account finance-coa.csv.
// FINANCE entity has NO COGS accounts — COGS is booked on SHOP side (deferred to A.5b).
// COGS_PRODUCT, COGS_REPAIR_PARTS — deprecated; FINANCE has no COGS. UI hides these.
const CATEGORY_CODE_MAP: Record<string, string> = {
  SELL_COMMISSION: '52-1101',       // ค่าคอมฯ พนักงาน
  SELL_ADVERTISING: '52-1102',      // ค่าส่งเสริมการขาย
  SELL_TRANSPORT: '53-1304',        // ค่าไปรษณีย์ และขนส่ง
  SELL_PACKAGING: '52-1102',        // nearest match (CSV lacks dedicated packaging)
  ADMIN_SALARY: '53-1101',          // เงินเดือน ค่าจ้าง
  ADMIN_SOCIAL_SECURITY: '53-1102', // เงินสมทบประกันสังคม (corrected from 53-1103 ค่าล่วงเวลา per audit)
  ADMIN_RENT: '53-1502',            // ค่าธรรมเนียมราชการ — TEMP placeholder; CSV needs dedicated rent (defer A.7)
  ADMIN_UTILITIES: '53-1302',       // ค่าไฟฟ้า
  ADMIN_OFFICE_SUPPLIES: '53-1201', // ค่าเครื่องเขียน วัสดุสำนักงาน
  ADMIN_DEPRECIATION: '53-1601',    // ค่าเสื่อมราคา-อุปกรณ์ (now exists in 105-CSV)
  ADMIN_INSURANCE: '53-1502',       // ค่าธรรมเนียมราชการ — TEMP; CSV needs dedicated insurance
  ADMIN_TAX_FEE: '54-1103',         // เบี้ยปรับ-ภ.พ.30 (รายจ่ายต้องห้าม)
  ADMIN_MAINTENANCE: '53-1305',     // ค่าซ่อมแซมฯ
  ADMIN_TRAVEL: '53-1304',          // ค่าไปรษณีย์ และขนส่ง
  ADMIN_TELEPHONE: '53-1303',       // ค่าโทรศัพท์สำนักงาน
  OTHER_INTEREST: '53-1501',        // ค่าธรรมเนียมธนาคาร
  OTHER_LOSS: '53-1503',            // กำไร(ขาดทุน) สุทธิจากการปัดเศษ
  OTHER_FINE: '54-1104',            // เบี้ยปรับเงินเพิ่ม (อื่นๆ)
  OTHER_MISC: '53-1502',            // ค่าธรรมเนียมราชการ
};

/**
 * Resolve a category string to a CoA account code.
 * Phase A.6: category column is now String (was enum), so we handle two cases:
 *  1. If it looks like a CoA code already (XX-XXXX), return as-is.
 *  2. Otherwise, treat as legacy enum key and look up in CATEGORY_CODE_MAP.
 * Returns null if not resolvable — caller should log warn + skip JE post.
 */
function resolveAccountCode(category: string): string | null {
  if (/^\d{2}-\d{4}$/.test(category)) return category;
  return CATEGORY_CODE_MAP[category] ?? null;
}

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
    private expenseTemplate: ExpenseTemplate,
  ) {}

  /**
   * Phase A.6 boot validator — verifies every code in CATEGORY_CODE_MAP exists
   * in the chart_of_accounts table. Throws on startup if any code is missing
   * so misconfiguration is caught immediately rather than at JE-post time.
   */
  async onModuleInit() {
    const codes = [...new Set(Object.values(CATEGORY_CODE_MAP))];
    const found = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true },
    });
    const foundSet = new Set(found.map((f) => f.code));
    const missing = codes.filter((c) => !foundSet.has(c));
    if (missing.length > 0) {
      const msg = `[Phase A.6] CATEGORY_CODE_MAP references missing CoA codes: ${missing.join(', ')}. Update CATEGORY_CODE_MAP or seed missing codes.`;
      this.logger.error(msg);
      throw new Error(msg);
    }
    this.logger.log(`CATEGORY_CODE_MAP validated: all ${codes.length} codes exist in CoA.`);
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

  // ─── Expenses CRUD ───────────────────────────────────────────────────────────

  async createExpense(dto: CreateExpenseDto, createdById: string) {
    // W-013: Validate expense date is not in a closed period.
    // Resolve companyId from branchId so AccountingPeriod model can be checked.
    const branch = dto.branchId
      ? await this.prisma.branch.findUnique({
          where: { id: dto.branchId },
          select: { companyId: true },
        })
      : null;
    await this.validatePeriodOpen(new Date(dto.expenseDate), branch?.companyId ?? undefined);

    const expectedAccountType = CATEGORY_ACCOUNT_MAP[dto.category];
    if (expectedAccountType && expectedAccountType !== dto.accountType) {
      throw new BadRequestException(
        `หมวดย่อย ${dto.category} ต้องอยู่ในหมวดหลัก ${expectedAccountType}`,
      );
    }

    let vatAmount = dto.vatAmount || 0;
    if (dto.includeVat && !dto.vatAmount) {
      const vatConfig = await this.prisma.systemConfig.findUnique({ where: { key: 'vat_pct' } });
      const vatRate = vatConfig ? d(vatConfig.value) : d(0.07);
      vatAmount = dRound(dMul(dto.amount, vatRate)).toNumber();
    }
    const withholdingTax = dto.withholdingTax || 0;
    const whtRate = dto.whtRate || null;
    const whtIncomeType = (dto.whtIncomeType as WhtIncomeType) || null;
    const totalAmount = dRound(dAdd(dto.amount, vatAmount)).toNumber();
    const netPayment = dRound(dSub(totalAmount, withholdingTax)).toNumber();
    const accountCode = dto.accountCode || resolveAccountCode(dto.category) || null;

    const expense = await this.prisma.$transaction(async (tx) => {
      const expenseNumber = await generateExpenseNumber(tx);

      return tx.expense.create({
        data: {
          expenseNumber,
          branchId: dto.branchId,
          accountType: dto.accountType,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          category: dto.category as any, // Phase A.6: String after migration; cast until Prisma client regenerates
          accountCode,
          description: dto.description,
          amount: dto.amount,
          vatAmount,
          totalAmount,
          withholdingTax,
          whtRate,
          whtIncomeType,
          netPayment,
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
    this.structuredLogger.log('expense.created', {
      expenseId: expense.id,
      expenseNumber: expense.expenseNumber,
      branchId: expense.branchId,
      accountType: expense.accountType,
      category: expense.category,
      totalAmount: Number(expense.totalAmount),
      createdById,
    });
    return expense;
  }

  async findAllExpenses(filters: {
    branchId?: string;
    accountType?: ExpenseAccountType;
    category?: string;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (category) where.category = category as any; // Phase A.6: String after migration; cast until Prisma client regenerates
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

    // T2-C12: once a staff member submits the expense for approval, the
    // monetary fields (amount, vatAmount, withholdingTax) are frozen. Only
    // description-like metadata may still be edited. Prevents silently
    // bumping a number between submission and approval. (APPROVED / PAID
    // are already fully blocked above — this catches PENDING_APPROVAL.)
    if (
      expense.status === 'PENDING_APPROVAL' &&
      (dto.amount !== undefined || dto.vatAmount !== undefined || dto.withholdingTax !== undefined)
    ) {
      throw new BadRequestException(
        'แก้ไขจำนวนเงิน / VAT / ภาษีหัก ณ ที่จ่าย ไม่ได้เมื่อรายจ่ายอยู่ในสถานะรออนุมัติ — ยกเลิกการส่งอนุมัติก่อน',
      );
    }

    const data: Prisma.ExpenseUpdateInput = {};
    if (dto.accountType !== undefined) data.accountType = dto.accountType;
    if (dto.category !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data.category = dto.category as any; // Phase A.6: String after migration; cast until Prisma client regenerates
      data.accountCode = resolveAccountCode(dto.category) || expense.accountCode;
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

    const amount = dto.amount !== undefined ? dto.amount : d(expense.amount).toNumber();
    const vatAmount = dto.vatAmount !== undefined ? dto.vatAmount : d(expense.vatAmount).toNumber();
    const withholdingTax = dto.withholdingTax !== undefined ? dto.withholdingTax : d(expense.withholdingTax).toNumber();
    if (dto.amount !== undefined || dto.vatAmount !== undefined || dto.withholdingTax !== undefined) {
      data.amount = amount;
      data.vatAmount = vatAmount;
      data.totalAmount = dAdd(amount, vatAmount).toNumber();
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
    if (expense.createdById === approvedById) {
      throw new BadRequestException('ผู้อนุมัติต้องไม่ใช่ผู้สร้างรายการ (Segregation of Duties)');
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
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id, deletedAt: null },
        include: { branch: { select: { companyId: true } } },
      });
      if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
      if (expense.status !== 'APPROVED') {
        throw new BadRequestException('ต้องอนุมัติก่อนถึงจะบันทึกจ่ายได้');
      }
      const updated = await tx.expense.update({
        where: { id },
        data: { status: 'PAID', paymentDate: paymentDate ? new Date(paymentDate) : new Date() },
      });

      // Phase A.5a: post expense JE (non-blocking — JE failure must not roll back the status update)
      try {
        await this.expenseTemplate.execute({
          expenseId: updated.id,
          depositAccountCode: '11-1101', // Default cash account; caller can pass custom in future
          isPaid: true,
        });
      } catch (err) {
        this.logger.error(
          `[A.5a] Expense JE failed for ${updated.expenseNumber}: ${(err as Error).message}`,
        );
      }

      return updated;
    });
  }

  async voidExpense(id: string, voidedById: string, voidReason: string) {
    if (!voidReason?.trim()) {
      throw new BadRequestException('กรุณาระบุเหตุผลในการยกเลิก');
    }
    const expense = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!expense) throw new NotFoundException('ไม่พบรายจ่าย');
    if (expense.status === 'VOIDED') {
      throw new BadRequestException('รายจ่ายนี้ถูกยกเลิกไปแล้ว');
    }
    if (expense.status === 'PAID') {
      const voider = await this.prisma.user.findUnique({ where: { id: voidedById } });
      if (voider?.role !== 'OWNER') {
        throw new BadRequestException('เฉพาะ OWNER เท่านั้นที่สามารถยกเลิกรายจ่ายที่จ่ายแล้ว');
      }
    }
    const voided = await this.prisma.expense.update({
      where: { id },
      data: { status: 'VOIDED', voidReason: voidReason.trim(), voidedById, voidedAt: new Date() },
    });
    this.structuredLogger.log('expense.voided', {
      expenseId: voided.id,
      expenseNumber: voided.expenseNumber,
      branchId: voided.branchId,
      totalAmount: Number(voided.totalAmount),
      voidedById,
      voidReason: voidReason.trim(),
    });
    return voided;
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
      const amt = new Prisma.Decimal(e.totalAmount);
      totalAmount = new Prisma.Decimal(totalAmount).add(amt).toNumber();
      byAccountType[e.accountType] = new Prisma.Decimal(byAccountType[e.accountType] ?? 0).add(amt).toNumber();
      byCategory[e.category] = new Prisma.Decimal(byCategory[e.category] ?? 0).add(amt).toNumber();
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
      breakdown[e.category].total = new Prisma.Decimal(breakdown[e.category].total).add(new Prisma.Decimal(e.totalAmount)).toNumber();
      breakdown[e.category].count++;
    }

    return Object.entries(breakdown)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''));
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

  /**
   * Check if a date falls in a closed accounting period.
   *
   * @param date        - The transaction date to validate.
   * @param companyId   - Optional. When provided, also checks the AccountingPeriod
   *                      model for a CLOSED/SYNCED period for that company's year+month.
   *                      Falls back to legacy SystemConfig check regardless.
   */
  private async validatePeriodOpen(date: Date, companyId?: string): Promise<void> {
    return validatePeriodOpenUtil(this.prisma, date, companyId);
  }

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
        // Expenses paid (cash outflow)
        this.prisma.expense.aggregate({
          where: { status: 'PAID', paymentDate: { lte: endDate }, deletedAt: null, ...branchFilter },
          _sum: { totalAmount: true },
        }),
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
        // 2300 WHT payable (from expenses with withholding tax)
        this.prisma.expense.aggregate({
          where: {
            status: { in: ['APPROVED', 'PAID'] },
            deletedAt: null,
            withholdingTax: { gt: 0 },
            expenseDate: { lte: endDate },
            ...branchFilter,
          },
          _sum: { withholdingTax: true },
        }),
        // 2600 Accrued expenses (approved but not yet paid)
        this.prisma.expense.aggregate({
          where: { status: 'APPROVED', deletedAt: null, expenseDate: { lte: endDate }, ...branchFilter },
          _sum: { totalAmount: true },
        }),
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
  };

  /**
   * Get Trial Balance from journal lines as of a given date.
   *
   * Queries all ChartOfAccount records and sums JournalLine debit/credit
   * from POSTED JournalEntries with entryDate <= asOfDate.
   *
   * Sections are grouped by the 2-digit prefix of the account code (11, 12, 21, …).
   * isBalanced = grandDrTotal equals grandCrTotal (accounting identity check).
   */
  async getTrialBalance(asOfDate?: Date) {
    const cutoff = asOfDate ?? new Date();

    // 1. Load all active chart of accounts
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null, status: 'ใช้งาน' },
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
        },
        deletedAt: null,
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
      const prefix = acc.code.slice(0, 2);
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
      const prefix = code.slice(0, 2);
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

    return {
      asOfDate: cutoff,
      sections,
      grandDrTotal,
      grandCrTotal,
      isBalanced: grandDrTotal.equals(grandCrTotal),
    };
  }

  /**
   * Get P&L from journal lines for a given period.
   *
   * Revenue = net Cr balance of accounts 41 + 42 for the period.
   * Expenses = net Dr balance of accounts 51 + 52 + 53 + 54 for the period.
   * Accounts in prefix 55 are EXCLUDED per CPA chart note ("ไม่นำมาแสดงในงบกำไรขาดทุน").
   *
   * Period filter: JournalEntry.entryDate between periodStart and periodEnd (inclusive).
   */
  async getProfitLossFromJournal(periodStart: Date, periodEnd: Date) {
    const REVENUE_PREFIXES = ['41', '42'];
    const EXPENSE_PREFIXES = ['51', '52', '53', '54']; // 55 excluded

    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
        },
        deletedAt: null,
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

    for (const row of lineSums) {
      const prefix = row.accountCode.slice(0, 2);
      const dr = new Prisma.Decimal(row._sum.debit ?? 0);
      const cr = new Prisma.Decimal(row._sum.credit ?? 0);
      const name = nameMap.get(row.accountCode) ?? row.accountCode;

      if (REVENUE_PREFIXES.includes(prefix)) {
        // Revenue accounts are Cr-normal: net = Cr - Dr
        const amount = cr.sub(dr);
        revenueRows.push({ code: row.accountCode, name, amount });
        revenueTotal = revenueTotal.add(amount);
      } else if (EXPENSE_PREFIXES.includes(prefix)) {
        // Expense accounts are Dr-normal: net = Dr - Cr
        const amount = dr.sub(cr);
        expenseRows.push({ code: row.accountCode, name, amount });
        expenseTotal = expenseTotal.add(amount);
      }
      // prefix 55 and others: skip
    }

    revenueRows.sort((a, b) => a.code.localeCompare(b.code));
    expenseRows.sort((a, b) => a.code.localeCompare(b.code));

    return {
      periodStart,
      periodEnd,
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
    const tb = await this.getTrialBalance(cutoff);

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
        // Cash paid for expenses
        this.prisma.expense.aggregate({
          where: { status: 'PAID', paymentDate: dateRange, deletedAt: null, ...branchFilter },
          _sum: { totalAmount: true },
        }),
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
