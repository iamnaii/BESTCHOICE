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
import { LineAggregatorService } from './services/line-aggregator.service';
import { JePreviewService } from './services/je-preview.service';

/**
 * Returns a Date representing 12:00 noon Asia/Bangkok on the same calendar day
 * as `now`. Used as a stable `postedAt` for journal entries that should land
 * on the BKK business day regardless of the server's UTC clock — without this,
 * a void after 17:00 BKK (= next UTC day) would post in the wrong accounting period.
 */
function bkkBusinessDate(now: Date): Date {
  const ymd = now.toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // ymd is "YYYY-MM-DD" in BKK; build noon BKK = 05:00 UTC of the same date
  return new Date(`${ymd}T05:00:00.000Z`);
}

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
    private readonly aggregator: LineAggregatorService,
    private readonly jePreview: JePreviewService,
  ) {}

  // ─── Create ──────────────────────────────────────────────────────────
  async create(dto: CreateExpenseDocumentDto, userId: string) {
    const documentDate = new Date(dto.documentDate);
    const priceType = dto.priceType ?? 'EXCLUSIVE';

    // Compute per-line totals + aggregate
    const linesPrepared = dto.lines.map((l, idx) => {
      const out = this.aggregator.computeLine(l, priceType);
      return { ...l, lineNo: idx + 1, ...out };
    });
    const totals = this.aggregator.aggregateLines(linesPrepared);

    return this.prisma.$transaction(async (tx) => {
      // CoA validation — every category must exist + be type "ค่าใช้จ่าย"
      const codes = [...new Set(linesPrepared.map((l) => l.category))];
      const coaRows = await tx.chartOfAccount.findMany({
        where: { code: { in: codes }, deletedAt: null },
        select: { code: true, type: true },
      });
      const byCode = new Map(coaRows.map((r) => [r.code, r.type]));
      for (const c of codes) {
        const t = byCode.get(c);
        if (!t) throw new BadRequestException(`หมวดบัญชี ${c} ไม่พบในผังบัญชี`);
        if (t !== 'ค่าใช้จ่าย') throw new BadRequestException(`หมวดบัญชี ${c} ไม่ใช่ "ค่าใช้จ่าย"`);
      }

      // Fix Report P0-4 — multi-line adjustment validation (V12/V13/V14).
      // When `amountPaid` differs from `netExpected = totalAmount − wht`, the
      // signed sum of adjustments must close the gap exactly.
      const adjustments = dto.adjustments ?? [];
      const totalAmount = new Prisma.Decimal(totals.totalAmount.toString());
      const wht = new Prisma.Decimal(totals.withholdingTax.toString());
      const netExpected = totalAmount.minus(wht);
      const amountPaid =
        dto.amountPaid !== undefined ? new Prisma.Decimal(dto.amountPaid) : netExpected;
      const diff = amountPaid.minus(netExpected);

      if (adjustments.length > 0 || !diff.eq(0)) {
        // V13/V14 — each row must have accountCode + amount > 0
        for (let i = 0; i < adjustments.length; i++) {
          const a = adjustments[i];
          if (!a.accountCode || !a.accountCode.trim()) {
            throw new BadRequestException(
              `V13: บัญชีปรับผลต่างแถวที่ ${i + 1} ยังไม่ได้เลือกบัญชี`,
            );
          }
          const amt = new Prisma.Decimal(a.amount);
          if (amt.lte(0)) {
            throw new BadRequestException(
              `V14: บัญชีปรับผลต่างแถวที่ ${i + 1}: จำนวนต้องมากกว่า 0`,
            );
          }
        }

        // V13 — adjustment account codes must exist in CoA (any type)
        if (adjustments.length > 0) {
          const adjCodes = [...new Set(adjustments.map((a) => a.accountCode))];
          const adjCoaRows = await tx.chartOfAccount.findMany({
            where: { code: { in: adjCodes }, deletedAt: null },
            select: { code: true },
          });
          const adjFound = new Set(adjCoaRows.map((r) => r.code));
          for (const c of adjCodes) {
            if (!adjFound.has(c)) {
              throw new BadRequestException(`V13: บัญชีปรับผลต่าง ${c} ไม่พบในผังบัญชี`);
            }
          }
        }

        // V12 — Σ signed(adjustments) must equal diff.
        // Signed convention: side='CR' contributes +amount (offsets Dr); side='DR' contributes −amount (offsets Cr).
        const signedSum = adjustments.reduce<Prisma.Decimal>((s, a) => {
          const amt = new Prisma.Decimal(a.amount);
          return a.side === 'CR' ? s.plus(amt) : s.minus(amt);
        }, new Prisma.Decimal(0));
        if (!signedSum.eq(diff)) {
          throw new BadRequestException(
            `V12: ผลรวมบัญชีปรับผลต่าง (signed = ${signedSum.toFixed(2)}) ` +
              `ไม่เท่ากับผลต่าง amount_paid − net_expected (${diff.toFixed(2)})`,
          );
        }
      }

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
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          withholdingTax: totals.withholdingTax,
          whtFormType: dto.whtFormType ?? null,
          totalAmount: totals.totalAmount,
          netPayment: dto.depositAccountCode ? amountPaid : null,
          paymentMethod: (dto.paymentMethod as never) ?? null,
          depositAccountCode: dto.depositAccountCode ?? null,
          status: 'DRAFT',
          reference: dto.reference ?? null,
          receiptImageUrl: dto.receiptImageUrl ?? null,
          note: dto.note ?? null,
          fromTemplateId: dto.fromTemplateId ?? null,
          approvedById: dto.approvedById ?? null,
          createdById: userId,
          expenseDetail: {
            create: {
              priceType,
              lines: {
                create: linesPrepared.map((l) => ({
                  lineNo: l.lineNo,
                  category: l.category,
                  description: l.description ?? null,
                  quantity: new Prisma.Decimal(l.quantity),
                  unitPrice: new Prisma.Decimal(l.unitPrice),
                  discount: new Prisma.Decimal(l.discount ?? 0),
                  vatPercent: new Prisma.Decimal(l.vatPercent ?? 0),
                  whtPercent: new Prisma.Decimal(l.whtPercent ?? 0),
                  whtFormType: l.whtFormType ?? null,
                  amountBeforeVat: l.amountBeforeVat,
                  vatAmount: l.vatAmount,
                  whtAmount: l.whtAmount,
                })),
              },
            },
          },
          adjustments:
            adjustments.length > 0
              ? {
                  create: adjustments.map((a, idx) => ({
                    lineNo: idx + 1,
                    accountCode: a.accountCode,
                    side: a.side,
                    amount: new Prisma.Decimal(a.amount),
                    note: a.note ?? null,
                  })),
                }
              : undefined,
        },
        include: {
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
          adjustments: { orderBy: { lineNo: 'asc' } },
        },
      });
    });
  }

  // ─── Credit Note create (validates + computes totals from lines) ──────────
  async createCreditNote(dto: CreateCreditNoteDto, userId: string) {
    // Compute per-line totals + aggregate server-side.
    // Inherits priceType from the original's expenseDetail (EXCLUSIVE by default).
    // dto.subtotal/vatAmount are IGNORED — server is the source of truth.
    const priceType = 'EXCLUSIVE';
    const linesPrepared = dto.lines.map((l, idx) => {
      const out = this.aggregator.computeLine(l, priceType);
      return { ...l, lineNo: idx + 1, ...out };
    });
    const totals = this.aggregator.aggregateLines(linesPrepared);

    return this.prisma.$transaction(async (tx) => {
      // CoA validation — every category must exist + be type "ค่าใช้จ่าย"
      const codes = [...new Set(linesPrepared.map((l) => l.category))];
      const coaRows = await tx.chartOfAccount.findMany({
        where: { code: { in: codes }, deletedAt: null },
        select: { code: true, type: true },
      });
      const byCode = new Map(coaRows.map((r) => [r.code, r.type]));
      for (const c of codes) {
        const t = byCode.get(c);
        if (!t) throw new BadRequestException(`หมวดบัญชี ${c} ไม่พบในผังบัญชี`);
        if (t !== 'ค่าใช้จ่าย') throw new BadRequestException(`หมวดบัญชี ${c} ไม่ใช่ "ค่าใช้จ่าย"`);
      }

      // Load + validate original
      const original = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: dto.originalDocumentId },
        include: { expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } } },
      });
      if (original.deletedAt) {
        throw new NotFoundException('เอกสารต้นฉบับถูกลบแล้ว');
      }
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

      // Cumulative cap check — use server-computed totals.totalAmount
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

      const cap = new Prisma.Decimal(original.totalAmount.toString()).minus(priorTotal);
      if (totals.totalAmount.gt(cap)) {
        throw new BadRequestException(
          `จำนวนเงินเกินยอดที่ลดได้ (เหลือ ${cap.toFixed(2)} ฿)`,
        );
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
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          withholdingTax: new Prisma.Decimal(0),
          totalAmount: totals.totalAmount,
          netPayment: dto.depositAccountCode ? totals.netPayment : null,
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
            },
          },
          expenseDetail: {
            create: {
              priceType,
              lines: {
                create: linesPrepared.map((l) => ({
                  lineNo: l.lineNo,
                  category: l.category,
                  description: l.description ?? null,
                  quantity: new Prisma.Decimal(l.quantity),
                  unitPrice: new Prisma.Decimal(l.unitPrice),
                  discount: new Prisma.Decimal(l.discount ?? 0),
                  vatPercent: new Prisma.Decimal(l.vatPercent ?? 0),
                  whtPercent: new Prisma.Decimal(l.whtPercent ?? 0),
                  whtFormType: l.whtFormType ?? null,
                  amountBeforeVat: l.amountBeforeVat,
                  vatAmount: l.vatAmount,
                  whtAmount: l.whtAmount,
                })),
              },
            },
          },
        },
        include: {
          creditNote: true,
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
        },
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

    // Branch scoping: cross-branch roles can pass ?branchId or omit it for "all";
    // non-cross-branch users are PINNED to their assigned branch — the query
    // param is ignored. If a non-cross-branch user has no branchId assigned
    // (data corruption), reject rather than fall through to query.branchId.
    if (hasCrossBranchAccess(user)) {
      if (query.branchId) where.branchId = query.branchId;
    } else {
      if (!user.branchId) {
        throw new ForbiddenException('ผู้ใช้ไม่มีสาขาที่ได้รับมอบหมาย');
      }
      where.branchId = user.branchId;
    }

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

    // Filter by ExpenseLine.category (e.g. CoA code "53-1302")
    if (query.category) {
      where.expenseDetail = { lines: { some: { category: query.category } } };
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
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
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
      // Decimal serialized as string ("1234.56") for parity with daily-summary
      // grandTotal — clients should parse for display rather than trusting JS float.
      accrualUnpaidTotal: accrualUnpaid._sum.totalAmount?.toFixed(2) ?? '0.00',
    };
  }

  /**
   * AP Aging — Fix Report P1-1.
   *
   * Returns ACCRUAL (unpaid) expenses bucketed by age since `documentDate`,
   * plus their per-bucket sums. Used by the APAgingPage with optional vendor /
   * bucket filters.
   *
   * Buckets (per Fix Report §1.3 P1-1):
   *   0-30 / 31-60 / 61-90 / 90+ days overdue
   *
   * Age is computed against "today BKK" (start-of-day) so a vendor's row that
   * just crossed midnight in Asia/Bangkok doesn't shift bucket vs server-tz.
   */
  async getApAging(filters: { branchId?: string; vendor?: string; bucket?: '0-30' | '31-60' | '61-90' | '90+' }) {
    const where: Prisma.ExpenseDocumentWhereInput = {
      deletedAt: null,
      status: 'ACCRUAL',
      paidAt: null,
    };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.vendor) {
      where.vendorName = { contains: filters.vendor, mode: 'insensitive' };
    }

    // Today in BKK at 00:00. (toLocaleString en-CA = YYYY-MM-DD; offset to UTC start.)
    const bkkParts = new Date().toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = bkkParts.split('-').map((s) => parseInt(s, 10));
    const bkkOffsetMs = 7 * 60 * 60 * 1000;
    const todayBkkStart = new Date(Date.UTC(y, m - 1, d) - bkkOffsetMs);

    const rows = await this.prisma.expenseDocument.findMany({
      where,
      select: {
        id: true,
        number: true,
        vendorName: true,
        vendorTaxId: true,
        documentDate: true,
        totalAmount: true,
        withholdingTax: true,
        branchId: true,
      },
      orderBy: { documentDate: 'asc' },
    });

    type Bucket = '0-30' | '31-60' | '61-90' | '90+';
    const toBucket = (ageDays: number): Bucket => {
      if (ageDays <= 30) return '0-30';
      if (ageDays <= 60) return '31-60';
      if (ageDays <= 90) return '61-90';
      return '90+';
    };

    const enriched = rows.map((r) => {
      const ageDays = Math.max(
        0,
        Math.floor((todayBkkStart.getTime() - new Date(r.documentDate).getTime()) / (24 * 60 * 60 * 1000)),
      );
      return { ...r, ageDays, bucket: toBucket(ageDays) };
    });

    const filtered = filters.bucket ? enriched.filter((r) => r.bucket === filters.bucket) : enriched;

    const zero = new Prisma.Decimal(0);
    const totals: Record<Bucket | 'TOTAL', { count: number; amount: Prisma.Decimal }> = {
      '0-30': { count: 0, amount: new Prisma.Decimal(0) },
      '31-60': { count: 0, amount: new Prisma.Decimal(0) },
      '61-90': { count: 0, amount: new Prisma.Decimal(0) },
      '90+': { count: 0, amount: new Prisma.Decimal(0) },
      TOTAL: { count: 0, amount: new Prisma.Decimal(0) },
    };
    // Bucket totals use the full unfiltered set so the user can see context even
    // when bucket filter is active.
    for (const r of enriched) {
      const amt = new Prisma.Decimal(r.totalAmount.toString()).minus(
        new Prisma.Decimal(r.withholdingTax?.toString() ?? '0'),
      );
      totals[r.bucket].count += 1;
      totals[r.bucket].amount = totals[r.bucket].amount.plus(amt);
      totals.TOTAL.count += 1;
      totals.TOTAL.amount = totals.TOTAL.amount.plus(amt);
    }
    void zero;

    return {
      buckets: {
        '0-30': { count: totals['0-30'].count, amount: totals['0-30'].amount.toFixed(2) },
        '31-60': { count: totals['31-60'].count, amount: totals['31-60'].amount.toFixed(2) },
        '61-90': { count: totals['61-90'].count, amount: totals['61-90'].amount.toFixed(2) },
        '90+': { count: totals['90+'].count, amount: totals['90+'].amount.toFixed(2) },
        TOTAL: { count: totals.TOTAL.count, amount: totals.TOTAL.amount.toFixed(2) },
      },
      docs: filtered.map((r) => ({
        id: r.id,
        number: r.number,
        vendorName: r.vendorName,
        vendorTaxId: r.vendorTaxId,
        documentDate: r.documentDate.toISOString(),
        ageDays: r.ageDays,
        bucket: r.bucket,
        // Net amount = totalAmount − wht (the cash leg pending payment).
        netAmount: new Prisma.Decimal(r.totalAmount.toString())
          .minus(new Prisma.Decimal(r.withholdingTax?.toString() ?? '0'))
          .toFixed(2),
        branchId: r.branchId,
      })),
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
        expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' }, take: 1 } } },
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

      // By category — primary line category (works for both EXPENSE and CREDIT_NOTE since
      // CN now uses expenseDetail.lines[] rather than the legacy creditNote.category column)
      const cat =
        (d as { expenseDetail?: { lines?: { category: string }[] } | null }).expenseDetail?.lines?.[0]?.category;
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

  // ─── Credit-Note remaining cap ───────────────────────────────────────
  // Returns how much CN can still be issued against this original document.
  // cap = original.totalAmount - Σ (non-VOIDED CNs against this original).
  async getCreditNoteCap(originalDocumentId: string) {
    const original = await this.prisma.expenseDocument.findUniqueOrThrow({
      where: { id: originalDocumentId },
    });
    if (original.deletedAt) {
      throw new NotFoundException('เอกสารต้นฉบับถูกลบแล้ว');
    }
    if (original.documentType !== 'EXPENSE') {
      throw new BadRequestException('ใบลดหนี้ใช้ลดเอกสารรายจ่ายเท่านั้น');
    }
    const priorAgg = await this.prisma.expenseDocument.aggregate({
      where: {
        documentType: 'CREDIT_NOTE',
        status: { not: 'VOIDED' },
        deletedAt: null,
        creditNote: { originalDocumentId },
      },
      _sum: { totalAmount: true },
    });
    const used = new Prisma.Decimal(priorAgg._sum.totalAmount ?? 0);
    const cap = new Prisma.Decimal(original.totalAmount.toString()).minus(used);
    return {
      originalTotal: original.totalAmount.toString(),
      usedTotal: used.toString(),
      remainingCap: cap.toString(),
    };
  }

  // ─── JE Preview (pure — no DB write) ────────────────────────────────
  async previewJe(dto: CreateExpenseDocumentDto) {
    const codes = new Set<string>();
    for (const l of dto.lines) codes.add(l.category);
    if (dto.depositAccountCode) codes.add(dto.depositAccountCode);
    // 11-4101 = ภาษีซื้อ (Input Tax Credit, claimable). Mirrors expense
    // templates' VAT routing — must match what post() actually books.
    codes.add('11-4101');
    codes.add('21-1104');
    if (dto.whtFormType === 'PND53') codes.add('21-3103'); else codes.add('21-3102');

    const rows = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: [...codes] }, deletedAt: null },
      select: { code: true, name: true },
    });
    const accountNames = new Map(rows.map((r) => [r.code, r.name]));
    return this.jePreview.preview(dto, accountNames);
  }

  // ─── Find one ────────────────────────────────────────────────────────
  async findOne(id: string) {
    const doc = await this.prisma.expenseDocument.findUniqueOrThrow({
      where: { id },
      include: {
        expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
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
      const existing = await tx.expenseDocument.findUniqueOrThrow({
        where: { id },
        include: { expenseDetail: { include: { lines: true } } },
      });
      if (existing.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
      this.transition.assertCanEdit({ from: existing.status });

      const data: Prisma.ExpenseDocumentUpdateInput = {};
      if (dto.documentDate) data.documentDate = new Date(dto.documentDate);
      if (dto.vendorName !== undefined) data.vendorName = dto.vendorName;
      if (dto.vendorTaxId !== undefined) data.vendorTaxId = dto.vendorTaxId;
      if (dto.taxInvoiceNo !== undefined) data.taxInvoiceNo = dto.taxInvoiceNo;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.whtFormType !== undefined) data.whtFormType = dto.whtFormType;
      if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod as never;
      if (dto.depositAccountCode !== undefined) data.depositAccountCode = dto.depositAccountCode;
      if (dto.reference !== undefined) data.reference = dto.reference;
      if (dto.receiptImageUrl !== undefined) data.receiptImageUrl = dto.receiptImageUrl;
      if (dto.note !== undefined) data.note = dto.note;
      if (dto.approvedById !== undefined) {
        data.approvedBy = dto.approvedById
          ? { connect: { id: dto.approvedById } }
          : { disconnect: true };
      }

      if (dto.lines !== undefined) {
        const priceType = dto.priceType ?? existing.expenseDetail?.priceType ?? 'EXCLUSIVE';
        const linesPrepared = dto.lines.map((l, idx) => {
          const out = this.aggregator.computeLine(l, priceType as never);
          return { ...l, lineNo: idx + 1, ...out };
        });

        // CoA validation — every category must exist + be type "ค่าใช้จ่าย"
        const codes = [...new Set(linesPrepared.map((l) => l.category))];
        const coaRows = await tx.chartOfAccount.findMany({
          where: { code: { in: codes }, deletedAt: null },
          select: { code: true, type: true },
        });
        const byCode = new Map(coaRows.map((r) => [r.code, r.type]));
        for (const c of codes) {
          const t = byCode.get(c);
          if (!t) throw new BadRequestException(`หมวดบัญชี ${c} ไม่พบในผังบัญชี`);
          if (t !== 'ค่าใช้จ่าย') throw new BadRequestException(`หมวดบัญชี ${c} ไม่ใช่ "ค่าใช้จ่าย"`);
        }

        const totals = this.aggregator.aggregateLines(linesPrepared);

        data.subtotal = totals.subtotal;
        data.vatAmount = totals.vatAmount;
        data.withholdingTax = totals.withholdingTax;
        data.totalAmount = totals.totalAmount;
        data.netPayment = (dto.depositAccountCode ?? existing.depositAccountCode)
          ? totals.netPayment
          : null;

        // Replace lines wholesale — expenseDetailId FK = documentId
        await tx.expenseLine.deleteMany({ where: { expenseDetailId: id } });
        await tx.expenseDetail.update({
          where: { documentId: id },
          data: {
            priceType: priceType as string,
            lines: {
              create: linesPrepared.map((l) => ({
                lineNo: l.lineNo,
                category: l.category,
                description: l.description ?? null,
                quantity: new Prisma.Decimal(l.quantity),
                unitPrice: new Prisma.Decimal(l.unitPrice),
                discount: new Prisma.Decimal(l.discount ?? 0),
                vatPercent: new Prisma.Decimal(l.vatPercent ?? 0),
                whtPercent: new Prisma.Decimal(l.whtPercent ?? 0),
                whtFormType: l.whtFormType ?? null,
                amountBeforeVat: l.amountBeforeVat,
                vatAmount: l.vatAmount,
                whtAmount: l.whtAmount,
              })),
            },
          },
        });
      }

      return tx.expenseDocument.update({
        where: { id },
        data,
        include: { expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } } },
      });
    });
  }

  // ─── Post (DRAFT → ACCRUAL or POSTED) ────────────────────────────────
  async post(id: string, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Per-doc advisory lock — serializes concurrent post calls on the same id.
      // Without this, two callers could both read DRAFT, both pass assertCanPost,
      // and both run the JE template → two journal entries for one document
      // (same race class as voidDocument).
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `post:${id}`);

      const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
      this.transition.assertCanPost({
        type: doc.documentType,
        from: doc.status,
        hasPaymentMethod: !!doc.paymentMethod && !!doc.depositAccountCode,
        totalAmount: doc.totalAmount.toString(),
      });

      // Fix #C10 — attachment threshold enforced server-side.
      // ATTACHMENT_REQUIRED_ABOVE_AMOUNT is set in /settings#attachment but
      // was previously only enforced by the frontend submit button. A direct
      // API call could POST a 500k expense with no receiptImageUrl → tax-audit
      // risk. Defense in depth: re-check at post() before any JE is written.
      const thresholdCfg = await tx.systemConfig.findUnique({
        where: { key: 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT' },
      });
      const rawThreshold = thresholdCfg?.value ?? '0';
      const threshold = new Prisma.Decimal(
        Number.isFinite(Number(rawThreshold)) ? rawThreshold : '0',
      );
      const docTotal = new Prisma.Decimal(doc.totalAmount.toString());
      if (threshold.gt(0) && docTotal.gte(threshold) && !doc.receiptImageUrl) {
        throw new BadRequestException(
          `เอกสารยอด ${docTotal.toFixed(2)} บาท ต้องแนบไฟล์ประกอบ (เกณฑ์ ${threshold.toFixed(2)} บาท)`,
        );
      }

      // EXPENSE + CREDIT_NOTE + PAYROLL + VENDOR_SETTLEMENT supported
      if (!['EXPENSE', 'CREDIT_NOTE', 'PAYROLL', 'VENDOR_SETTLEMENT'].includes(doc.documentType)) {
        throw new BadRequestException(`type ${doc.documentType} not supported`);
      }

      // Fix #C12 — WHT routing invariant. When the doc has WHT > 0, doc.whtFormType
      // MUST be non-null (and a recognised form). Previously the JE template silently
      // defaulted to PND3 → routed to 21-3102, misfiling juristic-vendor WHT under
      // ภ.ง.ด.3 instead of ภ.ง.ด.53 (government compliance bug).
      //
      // C12-symmetry (this PR): mirror the guard across all 4 doc types so any
      // future bypass surfaces at post() instead of being silently misrouted by
      // the template. Each doc type carries WHT differently:
      //   - EXPENSE: doc.whtFormType OR every ExpenseLine.whtFormType is set
      //     (per-line routing — P2-4)
      //   - PAYROLL: doc.withholdingTax > 0 → always Cr 21-3101 (ภ.ง.ด.1) —
      //     payroll WHT is employee income tax, NOT PND3/PND53, so no formType
      //     enforcement here (BUT we still require it to be null since the field
      //     is meaningless for payroll)
      //   - VENDOR_SETTLEMENT: single-vendor invariant means doc-level form type
      //     applies (intentionally no per-line routing per accounting.md)
      //   - CREDIT_NOTE: createCreditNote already blocks original-with-WHT
      //     (so CN itself ideally has no WHT), but if the original had WHT and
      //     this branch is reached, we still need doc-level formType
      const wht = new Prisma.Decimal(doc.withholdingTax?.toString() ?? '0');
      if (wht.gt(0)) {
        if (doc.documentType === 'EXPENSE') {
          if (!doc.whtFormType) {
            // Check if every WHT-bearing line has its own form type → fall through to
            // per-line routing in the template. Otherwise the doc-level is mandatory.
            const detail = await tx.expenseDetail.findUnique({
              where: { documentId: id },
              include: { lines: true },
            });
            const whtLines = (detail?.lines ?? []).filter(
              (l) => l.whtAmount && new Prisma.Decimal(l.whtAmount.toString()).gt(0),
            );
            const allLinesHaveFormType =
              whtLines.length > 0 && whtLines.every((l) => !!l.whtFormType);
            if (!allLinesHaveFormType) {
              throw new BadRequestException(
                'whtFormType ต้องระบุเมื่อมี WHT — เลือก PND3 หรือ PND53',
              );
            }
            // If every line has a form type, validate each is PND3/PND53 (no other strings)
            for (const l of whtLines) {
              if (l.whtFormType !== 'PND3' && l.whtFormType !== 'PND53') {
                throw new BadRequestException(
                  `whtFormType ของบรรทัด ${(l as { lineNo?: number }).lineNo ?? '?'} ` +
                    `ต้องเป็น PND3 หรือ PND53 (พบ ${l.whtFormType ?? 'null'})`,
                );
              }
            }
          } else if (doc.whtFormType !== 'PND3' && doc.whtFormType !== 'PND53') {
            throw new BadRequestException(
              `whtFormType ต้องเป็น PND3 หรือ PND53 (พบ ${doc.whtFormType})`,
            );
          }
        } else if (doc.documentType === 'VENDOR_SETTLEMENT' || doc.documentType === 'CREDIT_NOTE') {
          // Per-line routing intentionally NOT supported for SE (single-vendor
          // invariant per accounting.md) and CN (template routes by original.whtFormType
          // since CN itself carries no WHT — but defense in depth).
          if (!doc.whtFormType) {
            throw new BadRequestException(
              'whtFormType ต้องระบุเมื่อมี WHT — เลือก PND3 หรือ PND53',
            );
          }
          if (doc.whtFormType !== 'PND3' && doc.whtFormType !== 'PND53') {
            throw new BadRequestException(
              `whtFormType ต้องเป็น PND3 หรือ PND53 (พบ ${doc.whtFormType})`,
            );
          }
        }
        // PAYROLL: doc.whtFormType is meaningless (employee income tax always
        // routes to 21-3101 / ภ.ง.ด.1). No enforcement — payroll.template
        // posts to 21-3101 unconditionally when sumWht > 0.
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
        // V15 — ACCRUAL ห้ามมี WHT (ม.50 ป.รัษฎากร).
        // WHT เกิด "ขณะที่จ่ายเงินได้" → ACCRUAL is the accrual leg before
        // payment, so WHT must defer to the SETTLEMENT step. Booking WHT now
        // would put it in the wrong tax period and cause ภงด.53 misfile.
        // Fix Report P0-2.
        if (doc.withholdingTax && doc.withholdingTax.gt(0)) {
          throw new BadRequestException(
            'V15: เอกสารตั้งหนี้ (ACCRUAL) ห้ามมี WHT (มาตรา 50 ป.รัษฎากร) — ' +
              'WHT จะถูกบันทึกตอน Settlement เมื่อจ่ายเงินจริง',
          );
        }
        return this.accrualTemplate.execute(id, tx);
      }
    });
  }

  // ─── Void (any non-VOIDED → VOIDED) ──────────────────────────────────
  // Posts a reversal JE (flipped Dr/Cr) when the doc had a journal entry,
  // and for VENDOR_SETTLEMENT also reverts each cleared EX back to ACCRUAL.
  async voidDocument(id: string, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Per-doc advisory lock — serializes concurrent voids on the same id so
      // two callers cannot both pass assertCanVoid and double-post a reversal JE.
      // (PG REPEATABLE READ does not prevent this write skew on its own.)
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `void:${id}`);

      const doc = await tx.expenseDocument.findUniqueOrThrow({
        where: { id },
        include: { settlement: { include: { settlementLines: true } } },
      });
      if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');

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
      // Reversal postedAt is BKK noon "today" — keeps the entry inside the
      // intended Thai accounting day regardless of UTC server clock.
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
            postedAt: bkkBusinessDate(new Date()),
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
      // updateMany with deletedAt:null guard so a soft-deleted EX is not
      // resurrected — if it was already deleted, we simply skip + log.
      if (doc.documentType === 'VENDOR_SETTLEMENT' && doc.settlement) {
        for (const line of doc.settlement.settlementLines) {
          const result = await tx.expenseDocument.updateMany({
            where: { id: line.clearedDocumentId, deletedAt: null },
            data: { status: 'ACCRUAL', paidAt: null },
          });
          if (result.count === 0) {
            this.logger.warn(
              `Void SE ${doc.number}: cleared EX ${line.clearedDocumentId} was soft-deleted — skipped revert`,
            );
          }
        }
      }

      // Compare-and-swap on status — second concurrent caller (if it somehow
      // bypassed the advisory lock) sees count=0 and aborts. Belt-and-braces.
      const flip = await tx.expenseDocument.updateMany({
        where: { id, status: { not: 'VOIDED' } },
        data: { status: 'VOIDED' },
      });
      if (flip.count === 0) {
        throw new BadRequestException('เอกสารถูกยกเลิกไปแล้ว');
      }
      return tx.expenseDocument.findUniqueOrThrow({ where: { id } });
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
