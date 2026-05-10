import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Prisma, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { DocNumberService } from './services/doc-number.service';
import { StatusTransitionService } from './services/status-transition.service';
import { ExpenseSameDayTemplate } from '../journal/cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from '../journal/cpa-templates/expense-accrual.template';
import { CreditNoteTemplate } from '../journal/cpa-templates/credit-note.template';
import { PayrollTemplate } from '../journal/cpa-templates/payroll.template';
import { VendorSettlementTemplate } from '../journal/cpa-templates/vendor-settlement.template';
import { CreateExpenseDocumentDto } from './dto/create.dto';
import { UpdateExpenseDocumentDto } from './dto/update.dto';
import { ListExpenseDocumentsQueryDto } from './dto/list-query.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { hasCrossBranchAccess } from '../auth/branch-access.util';

@Injectable()
export class ExpenseDocumentsService {
  private readonly logger = new Logger(ExpenseDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly transition: StatusTransitionService,
    private readonly sameDayTemplate: ExpenseSameDayTemplate,
    private readonly accrualTemplate: ExpenseAccrualTemplate,
    private readonly creditNoteTemplate: CreditNoteTemplate,
    private readonly payrollTemplate: PayrollTemplate,
    private readonly settlementTemplate: VendorSettlementTemplate,
    private readonly journal: JournalAutoService,
  ) {}

  // ─── Create ──────────────────────────────────────────────────────────
  async create(dto: CreateExpenseDocumentDto, userId: string) {
    const documentDate = new Date(dto.documentDate);
    const subtotal = new Prisma.Decimal(dto.subtotal);
    const vat = new Prisma.Decimal(dto.vatAmount ?? 0);
    const wht = new Prisma.Decimal(dto.withholdingTax ?? 0);
    const total = subtotal.plus(vat);

    return this.prisma.$transaction(async (tx) => {
      const number = await this.docNumber.next(tx, 'EXPENSE', documentDate);
      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'EXPENSE',
          branchId: dto.branchId,
          documentDate,
          vendorName: dto.vendorName ?? null,
          vendorTaxId: dto.vendorTaxId ?? null,
          taxInvoiceNo: dto.taxInvoiceNo ?? null,
          description: dto.description ?? null,
          subtotal,
          vatAmount: vat,
          withholdingTax: wht,
          whtFormType: dto.whtFormType ?? null,
          totalAmount: total,
          netPayment: dto.depositAccountCode ? total.minus(wht) : null,
          paymentMethod: (dto.paymentMethod as never) ?? null,
          depositAccountCode: dto.depositAccountCode ?? null,
          status: 'DRAFT',
          reference: dto.reference ?? null,
          receiptImageUrl: dto.receiptImageUrl ?? null,
          note: dto.note ?? null,
          fromTemplateId: dto.fromTemplateId ?? null,
          createdById: userId,
          expenseDetail: { create: { category: dto.detail.category } },
        },
        include: { expenseDetail: true },
      });
    });
  }

  // ─── Credit Note create (validates + auto-mirrors category) ──────────
  async createCreditNote(dto: CreateCreditNoteDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Load + validate original
      const original = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: dto.originalDocumentId },
        include: { expenseDetail: true },
      });
      if (original.branchId !== dto.branchId) {
        throw new BadRequestException('ใบลดหนี้ต้องอยู่สาขาเดียวกับเอกสารต้นฉบับ');
      }
      if (original.documentType !== 'EXPENSE') {
        throw new BadRequestException('ใบลดหนี้ใช้ลดเอกสารรายจ่ายเท่านั้น');
      }
      if (!['ACCRUAL', 'POSTED'].includes(original.status)) {
        throw new BadRequestException(`ไม่สามารถออกใบลดหนี้บนเอกสารสถานะ ${original.status}`);
      }

      const origWht = new Prisma.Decimal(original.withholdingTax?.toString() ?? '0');
      if (origWht.gt(0)) {
        throw new BadRequestException(
          'ไม่รองรับใบลดหนี้บนเอกสารที่มีการหัก ณ ที่จ่าย — กรุณาใช้การยกเลิก (void) แล้วสร้างเอกสารใหม่',
        );
      }

      // Prevent race condition: two concurrent CN creations on same original could
      // both pass the cap check. Lock per original-document for the tx.
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        dto.originalDocumentId,
      );

      // Cumulative cap check
      const priorAgg = await tx.expenseDocument.aggregate({
        where: {
          documentType: 'CREDIT_NOTE',
          status: { not: 'VOIDED' },
          deletedAt: null,
          creditNote: { originalDocumentId: dto.originalDocumentId },
        },
        _sum: { totalAmount: true },
      });
      const priorTotal = new Prisma.Decimal(priorAgg._sum.totalAmount ?? 0);

      const subtotal = new Prisma.Decimal(dto.subtotal);
      const vat = new Prisma.Decimal(dto.vatAmount ?? 0);
      const total = subtotal.plus(vat);

      const cap = new Prisma.Decimal(original.totalAmount.toString()).minus(priorTotal);
      if (total.gt(cap)) {
        throw new BadRequestException(
          `จำนวนเงินเกินยอดที่ลดได้ (เหลือ ${cap.toFixed(2)} ฿)`,
        );
      }

      // Mirror category from original
      const category = original.expenseDetail?.category;
      if (!category) {
        throw new BadRequestException('เอกสารต้นฉบับไม่มีหมวดบัญชี (data corruption)');
      }

      const documentDate = new Date(dto.documentDate);
      const number = await this.docNumber.next(tx, 'CREDIT_NOTE', documentDate);

      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'CREDIT_NOTE',
          branchId: dto.branchId,
          documentDate,
          description: dto.description ?? null,
          subtotal,
          vatAmount: vat,
          withholdingTax: new Prisma.Decimal(0),
          totalAmount: total,
          netPayment: dto.depositAccountCode ? total : null,
          depositAccountCode: dto.depositAccountCode ?? null,
          status: 'DRAFT',
          reference: dto.reference ?? null,
          receiptImageUrl: dto.receiptImageUrl ?? null,
          note: dto.note ?? null,
          fromTemplateId: dto.fromTemplateId ?? null,
          createdById: userId,
          creditNote: {
            create: {
              originalDocumentId: dto.originalDocumentId,
              reason: dto.reason,
              category,
            },
          },
        },
        include: { creditNote: true },
      });
    });
  }

  // ─── Payroll create — multi-line, computes netPaid per line ──────────
  async createPayroll(
    dto: CreatePayrollDto,
    user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    // Branch access enforcement: users without cross-branch role
    // can only create payroll documents for their own branch.
    if (!hasCrossBranchAccess(user) && user.branchId !== dto.branchId) {
      throw new ForbiddenException('ไม่สามารถสร้างเอกสารในสาขาอื่นได้');
    }

    // Compute netPaid per line + validate
    const linesPrepared = dto.lines.map((l) => {
      const base = new Prisma.Decimal(l.baseSalary);
      const sso = new Prisma.Decimal(l.ssoEmployee ?? 0);
      const wht = new Prisma.Decimal(l.whtAmount ?? 0);
      const netPaid = base.minus(sso).minus(wht);
      if (netPaid.lt(0)) {
        throw new BadRequestException(
          `พนักงาน "${l.employeeName}" — เงินสุทธิติดลบ (ฐาน ${base} - SSO ${sso} - WHT ${wht})`,
        );
      }
      return {
        employeeName: l.employeeName,
        employeeTaxId: l.employeeTaxId ?? null,
        baseSalary: base,
        ssoEmployee: sso,
        whtAmount: wht,
        netPaid,
      };
    });

    if (linesPrepared.length === 0) {
      throw new BadRequestException('ต้องมีพนักงานอย่างน้อย 1 คน');
    }

    const sumBase = linesPrepared.reduce(
      (s, l) => s.plus(l.baseSalary),
      new Prisma.Decimal(0),
    );
    const sumWht = linesPrepared.reduce(
      (s, l) => s.plus(l.whtAmount),
      new Prisma.Decimal(0),
    );
    const sumNet = linesPrepared.reduce(
      (s, l) => s.plus(l.netPaid),
      new Prisma.Decimal(0),
    );

    const documentDate = new Date(dto.documentDate);
    return this.prisma.$transaction(async (tx) => {
      const number = await this.docNumber.next(tx, 'PAYROLL', documentDate);
      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'PAYROLL',
          branchId: dto.branchId,
          documentDate,
          description: dto.description ?? null,
          subtotal: sumBase,
          vatAmount: new Prisma.Decimal(0),
          withholdingTax: sumWht,
          totalAmount: sumBase,
          netPayment: sumNet,
          depositAccountCode: dto.depositAccountCode,
          paymentMethod: (dto.paymentMethod as never) ?? null,
          status: 'DRAFT',
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          fromTemplateId: dto.fromTemplateId ?? null,
          createdById: user.id,
          payroll: {
            create: {
              payrollPeriod: dto.payrollPeriod,
              lines: { create: linesPrepared },
            },
          },
        },
        include: { payroll: { include: { lines: true } } },
      });
    });
  }

  // ─── Vendor Settlement create — multi-line clears ACCRUAL EXs ────────
  async createSettlement(
    dto: CreateSettlementDto,
    user: { id: string; branchId?: string | null; role?: string },
  ) {
    if (!hasCrossBranchAccess(user) && user.branchId !== dto.branchId) {
      throw new ForbiddenException('ไม่สามารถสร้างเอกสารในสาขาอื่นได้');
    }

    // Dedup: prevent same cleared doc from appearing twice in one SE
    const seenClearedIds = new Set<string>();
    for (const line of dto.lines) {
      if (seenClearedIds.has(line.clearedDocumentId)) {
        throw new BadRequestException(
          `เอกสาร ${line.clearedDocumentId} ปรากฏซ้ำในรายการ`,
        );
      }
      seenClearedIds.add(line.clearedDocumentId);
    }

    return this.prisma.$transaction(async (tx) => {
      // Acquire advisory locks in sorted order to prevent deadlock under concurrent
      // SEs targeting overlapping cleared docs.
      const sortedClearedIds = [...new Set(dto.lines.map((l) => l.clearedDocumentId))].sort();
      for (const clearedId of sortedClearedIds) {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          clearedId,
        );
      }
      // Validate + load each cleared doc
      let sumSettled = new Prisma.Decimal(0);
      for (const line of dto.lines) {
        const cleared = await tx.expenseDocument.findUniqueOrThrow({
          where: { id: line.clearedDocumentId },
        });
        if (cleared.deletedAt) {
          throw new BadRequestException(`เอกสาร ${cleared.number} ถูกลบไปแล้ว`);
        }
        if (cleared.branchId !== dto.branchId) {
          throw new BadRequestException(`เอกสาร ${cleared.number} อยู่สาขาอื่น`);
        }
        if (cleared.documentType !== 'EXPENSE') {
          throw new BadRequestException(
            `เอกสาร ${cleared.number} ไม่ใช่ใบรายจ่าย (EX)`,
          );
        }
        if (cleared.status !== 'ACCRUAL') {
          throw new BadRequestException(
            `เอกสาร ${cleared.number} ไม่ได้อยู่ในสถานะ ACCRUAL (ขณะนี้: ${cleared.status})`,
          );
        }
        // Cap: amountSettled <= cleared.totalAmount minus prior settlements.
        // Only count POSTED SEs (DRAFT SEs not yet posted should not consume cap,
        // otherwise unposted drafts could starve other SEs from clearing the same doc).
        const priorAgg = await tx.settlementLine.aggregate({
          where: {
            clearedDocumentId: line.clearedDocumentId,
            settlement: {
              document: {
                status: 'POSTED',
                deletedAt: null,
              },
            },
          },
          _sum: { amountSettled: true },
        });
        const priorTotal = new Prisma.Decimal(priorAgg._sum.amountSettled ?? 0);
        const cap = new Prisma.Decimal(cleared.totalAmount.toString()).minus(priorTotal);
        const amount = new Prisma.Decimal(line.amountSettled);
        if (amount.gt(cap)) {
          throw new BadRequestException(
            `เอกสาร ${cleared.number} จำนวนที่จ่ายเกินยอดที่ค้าง (เหลือ ${cap.toFixed(2)} ฿)`,
          );
        }
        sumSettled = sumSettled.plus(amount);
      }

      const wht = new Prisma.Decimal(dto.withholdingTax ?? 0);
      if (wht.gt(sumSettled)) {
        throw new BadRequestException(
          `หัก ณ ที่จ่าย (${wht}) เกินยอดรวมที่จ่าย (${sumSettled})`,
        );
      }
      const documentDate = new Date(dto.documentDate);
      const number = await this.docNumber.next(tx, 'VENDOR_SETTLEMENT', documentDate);

      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'VENDOR_SETTLEMENT',
          branchId: dto.branchId,
          documentDate,
          vendorName: dto.vendorName ?? null,
          description: dto.description ?? null,
          subtotal: sumSettled,
          vatAmount: new Prisma.Decimal(0),
          withholdingTax: wht,
          whtFormType: dto.whtFormType ?? null,
          totalAmount: sumSettled,
          netPayment: sumSettled.minus(wht),
          depositAccountCode: dto.depositAccountCode,
          paymentMethod: (dto.paymentMethod as never) ?? null,
          status: 'DRAFT',
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          fromTemplateId: dto.fromTemplateId ?? null,
          createdById: user.id,
          settlement: {
            create: {
              settlementLines: {
                create: dto.lines.map((l) => ({
                  clearedDocumentId: l.clearedDocumentId,
                  amountSettled: new Prisma.Decimal(l.amountSettled),
                })),
              },
            },
          },
        },
        include: { settlement: { include: { settlementLines: true } } },
      });
    });
  }

  // ─── List ────────────────────────────────────────────────────────────
  async list(
    query: ListExpenseDocumentsQueryDto,
    user: { branchId?: string | null; role?: string },
  ) {
    const where: Prisma.ExpenseDocumentWhereInput = { deletedAt: null };

    // Branch scoping
    const effectiveBranchId = hasCrossBranchAccess(user)
      ? query.branchId
      : user.branchId || query.branchId;
    if (effectiveBranchId) where.branchId = effectiveBranchId;

    // Tab translation
    switch (query.tab) {
      case 'draft':
        where.status = 'DRAFT';
        break;
      case 'unpaid':
        where.status = 'ACCRUAL';
        break;
      case 'recorded':
        where.status = { in: ['ACCRUAL', 'POSTED'] };
        break;
      case 'paid':
        where.paidAt = { not: null };
        break;
      default:
        where.status = { not: 'VOIDED' };
    }

    // Explicit status overrides tab
    if (query.status) where.status = query.status as DocumentStatus;
    if (query.type) where.documentType = query.type as never;

    // Date range on documentDate
    if (query.startDate || query.endDate) {
      where.documentDate = {};
      if (query.startDate) where.documentDate.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.documentDate.lte = end;
      }
    }

    // Filter by ExpenseDetail.category (e.g. CoA code "53-1302")
    if (query.category) {
      where.expenseDetail = { category: query.category };
    }

    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { vendorName: { contains: query.search, mode: 'insensitive' } },
        { taxInvoiceNo: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const [data, total] = await Promise.all([
      this.prisma.expenseDocument.findMany({
        where,
        include: {
          expenseDetail: true,
          branch: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { documentDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseDocument.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // ─── Summary aggregations ────────────────────────────────────────────
  async getSummary(filters: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const where: Prisma.ExpenseDocumentWhereInput = {
      deletedAt: null,
      status: { not: 'VOIDED' },
    };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.startDate || filters.endDate) {
      where.documentDate = {};
      if (filters.startDate) where.documentDate.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        where.documentDate.lte = end;
      }
    }

    // Server-side aggregation — does not load full rows into memory.
    const [totalCount, statusGroups, accrualUnpaid] = await Promise.all([
      this.prisma.expenseDocument.count({ where }),
      this.prisma.expenseDocument.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.expenseDocument.aggregate({
        where: { ...where, status: 'ACCRUAL', paidAt: null },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const g of statusGroups) byStatus[g.status] = g._count._all;

    return {
      totalCount,
      byStatus,
      accrualUnpaidCount: accrualUnpaid._count._all,
      accrualUnpaidTotal: accrualUnpaid._sum.totalAmount?.toNumber() ?? 0,
    };
  }

  // ─── Daily summary (print-ready aggregation) ─────────────────────────
  async getDailySummary(
    filters: { date: string; branchId?: string },
    user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    const branchId = hasCrossBranchAccess(user)
      ? filters.branchId
      : (user.branchId ?? filters.branchId);
    if (!branchId) {
      throw new BadRequestException('ต้องระบุสาขา');
    }
    const start = new Date(filters.date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(filters.date);
    end.setHours(23, 59, 59, 999);

    const documents = await this.prisma.expenseDocument.findMany({
      where: {
        branchId,
        documentDate: { gte: start, lte: end },
        status: { not: 'VOIDED' },
        deletedAt: null,
      },
      include: {
        expenseDetail: true,
        creditNote: true,
        payroll: true,
        settlement: true,
        branch: { select: { id: true, name: true } },
      },
      orderBy: { number: 'asc' },
    });

    // Aggregate
    const byType: Record<string, { count: number; total: string }> = {};
    const byPaymentMethod: Record<string, { count: number; total: string }> = {};
    const byCategory: Record<string, { count: number; total: string }> = {};
    const cashMovement: Record<string, { out: string; count: number }> = {};

    let grandTotal = new Prisma.Decimal(0);

    for (const d of documents) {
      const total = new Prisma.Decimal(d.totalAmount.toString());
      grandTotal = grandTotal.plus(total);

      // By type
      const tKey = d.documentType;
      const tBucket = byType[tKey] ?? { count: 0, total: '0' };
      tBucket.count++;
      tBucket.total = new Prisma.Decimal(tBucket.total).plus(total).toFixed(2);
      byType[tKey] = tBucket;

      // By payment method (only if doc has paymentMethod set)
      if (d.paymentMethod) {
        const mKey = d.paymentMethod;
        const mBucket = byPaymentMethod[mKey] ?? { count: 0, total: '0' };
        mBucket.count++;
        const netAmt = d.netPayment ? new Prisma.Decimal(d.netPayment.toString()) : total;
        mBucket.total = new Prisma.Decimal(mBucket.total).plus(netAmt).toFixed(2);
        byPaymentMethod[mKey] = mBucket;
      }

      // By category (EXPENSE + CREDIT_NOTE — others have no category)
      const cat =
        (d as { expenseDetail?: { category: string } | null }).expenseDetail?.category ??
        (d as { creditNote?: { category: string } | null }).creditNote?.category;
      if (cat) {
        const cBucket = byCategory[cat] ?? { count: 0, total: '0' };
        cBucket.count++;
        cBucket.total = new Prisma.Decimal(cBucket.total).plus(total).toFixed(2);
        byCategory[cat] = cBucket;
      }

      // Cash movement (only docs with depositAccountCode + paidAt today)
      if (d.depositAccountCode && d.paidAt && d.paidAt >= start && d.paidAt <= end) {
        const aKey = d.depositAccountCode;
        const aBucket = cashMovement[aKey] ?? { out: '0', count: 0 };
        const netAmt = d.netPayment ? new Prisma.Decimal(d.netPayment.toString()) : total;
        aBucket.out = new Prisma.Decimal(aBucket.out).plus(netAmt).toFixed(2);
        aBucket.count++;
        cashMovement[aKey] = aBucket;
      }
    }

    return {
      date: filters.date,
      branchId,
      branchName: documents[0]?.branch?.name ?? null,
      documents,
      grandTotal: grandTotal.toFixed(2),
      byType,
      byPaymentMethod,
      byCategory,
      cashMovement,
    };
  }

  // ─── Find one ────────────────────────────────────────────────────────
  async findOne(id: string) {
    const doc = await this.prisma.expenseDocument.findUniqueOrThrow({
      where: { id },
      include: {
        expenseDetail: true,
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
    if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
    return doc;
  }

  // ─── Update (DRAFT only) ─────────────────────────────────────────────
  async update(id: string, dto: UpdateExpenseDocumentDto, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      this.transition.assertCanEdit({ from: existing.status });

      const data: Prisma.ExpenseDocumentUpdateInput = {};
      if (dto.documentDate) data.documentDate = new Date(dto.documentDate);
      if (dto.vendorName !== undefined) data.vendorName = dto.vendorName;
      if (dto.vendorTaxId !== undefined) data.vendorTaxId = dto.vendorTaxId;
      if (dto.taxInvoiceNo !== undefined) data.taxInvoiceNo = dto.taxInvoiceNo;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.subtotal !== undefined) data.subtotal = new Prisma.Decimal(dto.subtotal);
      if (dto.vatAmount !== undefined) data.vatAmount = new Prisma.Decimal(dto.vatAmount);
      if (dto.withholdingTax !== undefined) data.withholdingTax = new Prisma.Decimal(dto.withholdingTax);
      if (dto.whtFormType !== undefined) data.whtFormType = dto.whtFormType;
      if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod as never;
      if (dto.depositAccountCode !== undefined) data.depositAccountCode = dto.depositAccountCode;
      if (dto.reference !== undefined) data.reference = dto.reference;
      if (dto.receiptImageUrl !== undefined) data.receiptImageUrl = dto.receiptImageUrl;
      if (dto.note !== undefined) data.note = dto.note;
      // Recalculate totalAmount + netPayment if money fields touched.
      // netPayment is set only when there's a payment dimension (depositAccountCode).
      if (
        dto.subtotal !== undefined ||
        dto.vatAmount !== undefined ||
        dto.withholdingTax !== undefined ||
        dto.depositAccountCode !== undefined
      ) {
        const subtotal = dto.subtotal !== undefined
          ? new Prisma.Decimal(dto.subtotal)
          : new Prisma.Decimal(existing.subtotal.toString());
        const vat = dto.vatAmount !== undefined
          ? new Prisma.Decimal(dto.vatAmount)
          : new Prisma.Decimal(existing.vatAmount.toString());
        const wht = dto.withholdingTax !== undefined
          ? new Prisma.Decimal(dto.withholdingTax)
          : new Prisma.Decimal(existing.withholdingTax.toString());
        const total = subtotal.plus(vat);
        data.totalAmount = total;
        const hasDepositAccount = dto.depositAccountCode !== undefined
          ? !!dto.depositAccountCode
          : !!existing.depositAccountCode;
        data.netPayment = hasDepositAccount ? total.minus(wht) : null;
      }

      const updated = await tx.expenseDocument.update({ where: { id }, data });
      if (dto.detail?.category) {
        await tx.expenseDetail.update({
          where: { documentId: id },
          data: { category: dto.detail.category },
        });
      }
      return updated;
    });
  }

  // ─── Post (DRAFT → ACCRUAL or POSTED) ────────────────────────────────
  async post(id: string, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      this.transition.assertCanPost({
        type: doc.documentType,
        from: doc.status,
        hasPaymentMethod: !!doc.paymentMethod && !!doc.depositAccountCode,
      });

      // EXPENSE + CREDIT_NOTE + PAYROLL + VENDOR_SETTLEMENT supported
      if (!['EXPENSE', 'CREDIT_NOTE', 'PAYROLL', 'VENDOR_SETTLEMENT'].includes(doc.documentType)) {
        throw new BadRequestException(`type ${doc.documentType} not supported`);
      }

      if (doc.documentType === 'CREDIT_NOTE') {
        return this.creditNoteTemplate.execute(id, tx);
      }
      if (doc.documentType === 'PAYROLL') {
        return this.payrollTemplate.execute(id, tx);
      }
      if (doc.documentType === 'VENDOR_SETTLEMENT') {
        return this.settlementTemplate.execute(id, tx);
      }
      const target = this.transition.resolveTargetStatus(
        doc.documentType,
        !!doc.paymentMethod && !!doc.depositAccountCode,
      );
      if (target === 'POSTED') {
        return this.sameDayTemplate.execute(id, tx);
      } else {
        return this.accrualTemplate.execute(id, tx);
      }
    });
  }

  // ─── Void (any non-VOIDED → VOIDED) ──────────────────────────────────
  // Posts a reversal JE (flipped Dr/Cr) when the doc had a journal entry,
  // and for VENDOR_SETTLEMENT also reverts each cleared EX back to ACCRUAL.
  async voidDocument(id: string, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.expenseDocument.findUniqueOrThrow({
        where: { id },
        include: { settlement: { include: { settlementLines: true } } },
      });

      const pendingCn = await tx.expenseDocument.count({
        where: {
          documentType: 'CREDIT_NOTE',
          status: { not: 'VOIDED' },
          deletedAt: null,
          creditNote: { originalDocumentId: id },
        },
      });
      if (pendingCn > 0) {
        throw new BadRequestException('มีใบลดหนี้ที่ยังไม่ถูกยกเลิก ไม่สามารถยกเลิกเอกสารต้นฉบับได้');
      }

      this.transition.assertCanVoid({ from: doc.status });

      // Post reversal JE (flipped Dr/Cr) if doc had one. The original JE stays
      // intact; the reversal lives as a separate POSTED entry tagged via metadata.
      if (doc.journalEntryId) {
        const original = await tx.journalEntry.findUniqueOrThrow({
          where: { id: doc.journalEntryId },
          include: { lines: true },
        });
        await this.journal.createAndPost(
          {
            description: `กลับรายการ ${doc.number}`,
            reference: doc.id,
            metadata: {
              tag: 'EXPENSE_VOID_REVERSAL',
              documentId: doc.id,
              documentNumber: doc.number,
              documentType: doc.documentType,
              originalJournalEntryId: original.id,
              flow: `expense-${doc.documentType.toLowerCase()}-void`,
            },
            postedAt: new Date(),
            companyId: original.companyId,
            lines: original.lines.map((l) => ({
              accountCode: l.accountCode,
              dr: new Prisma.Decimal(l.credit.toString()),
              cr: new Prisma.Decimal(l.debit.toString()),
              description: l.description ? `[กลับรายการ] ${l.description}` : '[กลับรายการ]',
            })),
          },
          tx,
        );
      }

      // VENDOR_SETTLEMENT side-effect: revert each cleared EX back to ACCRUAL.
      // The SE was the only thing that flipped them to POSTED + paidAt; voiding
      // the SE must undo that, otherwise the EXs stay POSTED with no payment.
      if (doc.documentType === 'VENDOR_SETTLEMENT' && doc.settlement) {
        for (const line of doc.settlement.settlementLines) {
          await tx.expenseDocument.update({
            where: { id: line.clearedDocumentId },
            data: { status: 'ACCRUAL', paidAt: null },
          });
        }
      }

      return tx.expenseDocument.update({
        where: { id },
        data: { status: 'VOIDED' },
      });
    });
  }

  // ─── Soft delete (DRAFT only) ────────────────────────────────────────
  async softDelete(id: string, _userId: string) {
    const existing = await this.prisma.expenseDocument.findUniqueOrThrow({ where: { id } });
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('ลบได้เฉพาะเอกสาร DRAFT — เอกสารที่ post ไปแล้ว ใช้ void แทน');
    }
    if (existing.deletedAt) {
      throw new BadRequestException('เอกสารถูกลบไปแล้ว');
    }
    return this.prisma.expenseDocument.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
