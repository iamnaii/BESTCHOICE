import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { JePreviewService } from './je-preview.service';
import { collectJePreviewCodes } from '../je-preview-codes.util';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { maskPayrollTaxIds } from '../payroll-pii-mask.util';
import { CreateExpenseDocumentDto } from '../dto/create.dto';
import { ListExpenseDocumentsQueryDto } from '../dto/list-query.dto';

/**
 * Phase 1 of the transactional-core decompose: the 9 READ-only methods of
 * ExpenseDocumentsService, extracted VERBATIM. The facade delegates to this
 * service so the public contract (controller + callers) is unchanged.
 *
 * Behavior-preserving — method bodies are byte-identical to the pre-extraction
 * facade; only import paths were adjusted for the deeper directory.
 */
@Injectable()
export class ExpenseDocumentQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jePreview: JePreviewService,
  ) {}

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
   * Phase A.5 — Tax-disallowed summary for ภ.ง.ด.50/51 prep.
   *
   * Returns the total amount of expense documents flagged as tax-disallowed
   * (ม.65 ตรี ป.รัษฎากร) over a date range. Used by the accountant at year-
   * end to exclude these from the deductible-expense total on the corporate
   * income-tax filing.
   *
   * Two roll-ups:
   *   - `docLevelTotal`: sum(totalAmount) of POSTED docs with doc-level flag
   *   - `lineLevelTotal`: sum(amountBeforeVat) of line-level overrides on
   *      docs NOT already disallowed at doc-level (avoid double-count)
   *
   * Both are POSTED-only — DRAFT / ACCRUAL / VOIDED are excluded since they
   * aren't yet on the books. `from` / `to` filter by `documentDate` (BKK).
   * When omitted, scans every POSTED document (use the calling controller's
   * default = current calendar year if you want a "this year" view).
   */
  async getTaxDisallowedSummary(filters: {
    branchId?: string;
    from?: string;
    to?: string;
  }) {
    const where: Prisma.ExpenseDocumentWhereInput = {
      deletedAt: null,
      status: 'POSTED',
    };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.from || filters.to) {
      where.documentDate = {};
      if (filters.from) where.documentDate.gte = new Date(filters.from);
      if (filters.to) {
        const end = new Date(filters.to);
        end.setHours(23, 59, 59, 999);
        where.documentDate.lte = end;
      }
    }

    // Doc-level: all lines in the doc are disallowed → sum totalAmount.
    const docLevel = await this.prisma.expenseDocument.aggregate({
      where: { ...where, taxDisallowed: true },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });

    // Line-level: only count rows where the PARENT doc is NOT already flagged
    // doc-level (otherwise we'd double-count those lines). Sum `amountBeforeVat`
    // because tax deductibility is computed on the pre-VAT amount — VAT input
    // is handled separately on ภ.พ.30, not on ภ.ง.ด.50/51.
    const lineLevel = await this.prisma.expenseLine.aggregate({
      where: {
        taxDisallowed: true,
        expenseDetail: {
          document: { ...where, taxDisallowed: false },
        },
      },
      _count: { _all: true },
      _sum: { amountBeforeVat: true },
    });

    const docTotal = docLevel._sum.totalAmount ?? new Prisma.Decimal(0);
    const lineTotal = lineLevel._sum.amountBeforeVat ?? new Prisma.Decimal(0);
    const grandTotal = docTotal.plus(lineTotal);

    return {
      docLevelCount: docLevel._count._all,
      docLevelTotal: docTotal.toFixed(2),
      lineLevelCount: lineLevel._count._all,
      lineLevelTotal: lineTotal.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      filters: { from: filters.from ?? null, to: filters.to ?? null },
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

    // W2 fix — age in calendar days, computed on BKK date strings.
    // Previous implementation took (todayBkkStart UTC ms − documentDate UTC ms)
    // / 86_400_000 and floored. Because documentDate stores UTC midnight (00:00Z
    // = 07:00 BKK same day) while todayBkkStart was UTC minus 7h (=BKK midnight
    // mapped to 17:00Z previous UTC day), the ms-diff was non-integer around
    // the boundary, so floor() shifted some rows by ±1 day (e.g. a doc dated
    // today appeared as 1 day old, pushing it from 0-30 to 31-60 right at
    // 17:00 BKK / 30 days later). Switch to calendar-day diff on YYYY-MM-DD
    // strings instead.
    const toBkkDate = (d: Date): string =>
      d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const todayBkkStr = toBkkDate(new Date());
    const daysBetween = (a: string, b: string): number => {
      // a, b are 'YYYY-MM-DD'. Build UTC midnights and subtract — exact integer
      // because both sides are at the same UTC hour.
      const [ay, am, ad] = a.split('-').map(Number);
      const [by, bm, bd] = b.split('-').map(Number);
      const aMs = Date.UTC(ay, am - 1, ad);
      const bMs = Date.UTC(by, bm - 1, bd);
      return Math.round((bMs - aMs) / (24 * 60 * 60 * 1000));
    };

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
      const docBkkStr = toBkkDate(new Date(r.documentDate));
      const ageDays = Math.max(0, daysBetween(docBkkStr, todayBkkStr));
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
        // I4 fix — pull ALL expense lines (not just the first) so the
        // "by category" aggregation reflects every line's category, weighted
        // by amountBeforeVat. Previously `take: 1` made multi-line docs all
        // collapse to their first line's category — a 3-line doc with 1k of
        // category A and 2x 5k of B would attribute all 11k to A. With this
        // include the daily summary instead sums per-line amounts into the
        // right buckets.
        expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
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

      // I4 — By category: sum per-line amounts into category buckets so a
      // multi-line doc contributes correctly to each category. count uses
      // 1 per distinct category in the doc (not per line) so a doc with
      // 3 cleaning lines counts once for "cleaning", not three times.
      // Defensive: legacy rows without `amountBeforeVat` (data migration
      // artefacts) fall back to 0 — they still count toward the bucket's
      // doc count but contribute no value.
      const lines =
        (d as { expenseDetail?: { lines?: { category: string; amountBeforeVat?: unknown }[] } | null })
          .expenseDetail?.lines ?? [];
      const seenInDoc = new Set<string>();
      for (const l of lines) {
        const cat = l.category;
        const raw = l.amountBeforeVat;
        const lineAmt = raw != null ? new Prisma.Decimal(raw.toString()) : new Prisma.Decimal(0);
        const cBucket = byCategory[cat] ?? { count: 0, total: '0' };
        if (!seenInDoc.has(cat)) {
          cBucket.count++;
          seenInDoc.add(cat);
        }
        cBucket.total = new Prisma.Decimal(cBucket.total).plus(lineAmt).toFixed(2);
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
    const codes = collectJePreviewCodes(dto);
    const rows = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: [...codes] }, deletedAt: null },
      select: { code: true, name: true },
    });
    const accountNames = new Map(rows.map((r) => [r.code, r.name]));
    return this.jePreview.preview(dto, accountNames);
  }

  // ─── Audit trail ─────────────────────────────────────────────────────
  // Immutable event timeline for one expense document, consumed by the shared
  // InternalControlActionBar audit timeline on the ExpenseDetailPage. Mirrors
  // OtherIncomeService.getAuditTrail. Both entity casings are queried for
  // resilience (services write 'expense_document'; defensive include of the
  // PascalCase form in case a future writer / interceptor differs).
  async getAuditTrail(
    id: string,
    user?: { branchId?: string | null; role?: string | null },
  ) {
    // Verify the document exists (throws on unknown / soft-deleted id).
    const doc = await this.findOne(id);
    // Branch scoping (mirrors create()/list() guards) — a non-cross-branch role
    // may only read the audit trail of documents in its OWN branch, so a
    // BRANCH_MANAGER can't pull another branch's audit history by guessing an id.
    if (
      user &&
      !hasCrossBranchAccess({ role: user.role ?? '' }) &&
      doc.branchId &&
      doc.branchId !== user.branchId
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสารของสาขาอื่น');
    }
    return this.prisma.auditLog.findMany({
      where: {
        entityId: id,
        entity: { in: ['expense_document', 'ExpenseDocument'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  // ─── Find one ────────────────────────────────────────────────────────
  // I5 — include type-specific detail so single-doc views (PaymentVoucher,
  // CN view, payroll view, SE view) don't need a follow-up roundtrip. The
  // base includes (expenseDetail / branch / approver) work for every type;
  // creditNote / payroll / settlement detail are added based on documentType.
  async findOne(id: string, viewerRole?: string | null) {
    // First pass to read documentType, then a typed include.
    const docType = await this.prisma.expenseDocument.findUniqueOrThrow({
      where: { id },
      select: { documentType: true, deletedAt: true },
    });
    if (docType.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');

    const doc = await this.prisma.expenseDocument.findUniqueOrThrow({
      where: { id },
      include: {
        expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
        adjustments: { orderBy: { lineNo: 'asc' } },
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        // Conditional includes by documentType — Prisma allows boolean here
        // and noop when the relation row doesn't exist for the type.
        creditNote: docType.documentType === 'CREDIT_NOTE',
        payroll:
          docType.documentType === 'PAYROLL'
            ? {
                include: {
                  lines: {
                    include: {
                      customIncome: { orderBy: { createdAt: 'asc' } },
                      customDeduction: { orderBy: { createdAt: 'asc' } },
                    },
                  },
                },
              }
            : false,
        settlement:
          docType.documentType === 'VENDOR_SETTLEMENT'
            ? { include: { settlementLines: true } }
            : false,
      },
    });
    if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
    // PR-C PII — mask payroll taxIds in the read response. Cast required
    // because Prisma's conditional-include type for payroll doesn't statically
    // carry the nested lines shape; the runtime value is correct.
    maskPayrollTaxIds(
      doc as { payroll?: { lines: Array<{ employeeTaxId: string | null }> } | null },
      viewerRole,
    );
    return doc;
  }
}
