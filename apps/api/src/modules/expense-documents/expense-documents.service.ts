import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Prisma, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DocNumberService } from './services/doc-number.service';
import { StatusTransitionService } from './services/status-transition.service';
import { ExpenseSameDayTemplate } from '../journal/cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from '../journal/cpa-templates/expense-accrual.template';
import { CreateExpenseDocumentDto } from './dto/create.dto';
import { UpdateExpenseDocumentDto } from './dto/update.dto';
import { ListExpenseDocumentsQueryDto } from './dto/list-query.dto';
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
          createdById: userId,
          expenseDetail: { create: { category: dto.detail.category } },
        },
        include: { expenseDetail: true },
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

      // EXPENSE only in PR-1
      if (doc.documentType !== 'EXPENSE') {
        throw new BadRequestException(`PR-1 รองรับเฉพาะ EXPENSE — type ${doc.documentType} จะมาใน PR-2..4`);
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
  async voidDocument(id: string, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      this.transition.assertCanVoid({ from: doc.status });

      // Reverse JE if doc was POSTED/ACCRUAL — full Dr↔Cr swap is deferred.
      // PR-1 just flips status to VOIDED. Followup work in journal helper.
      if (doc.journalEntryId) {
        this.logger.warn(`Voiding doc ${id} with posted JE — reverse JE TODO in journal helper`);
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
