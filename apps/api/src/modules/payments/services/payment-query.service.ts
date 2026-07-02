import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { paginatedResponse } from '../../../common/helpers/pagination.helper';
import { roundBaht } from '../../../utils/installment.util';
import { loadLateFeeConfig, resolveLivePaymentLateFee } from '../../../utils/late-fee.util';

/**
 * Build a Prisma `dueDate` range filter from BKK-local YYYY-MM-DD bounds.
 * `dueTo` is INCLUSIVE — we add one day and use `lt` so the whole end day is
 * covered. Returns `null` when neither bound is supplied (= "ทั้งหมด", no
 * filter). Bad/empty inputs are ignored gracefully.
 */
function buildDueDateRange(
  dueFrom?: string,
  dueTo?: string,
): { gte?: Date; lt?: Date } | null {
  const range: { gte?: Date; lt?: Date } = {};
  if (dueFrom) {
    const f = new Date(dueFrom);
    if (!isNaN(f.getTime())) {
      range.gte = new Date(f.getFullYear(), f.getMonth(), f.getDate());
    }
  }
  if (dueTo) {
    const t = new Date(dueTo);
    if (!isNaN(t.getTime())) {
      // inclusive end → start of the NEXT day
      range.lt = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    }
  }
  return range.gte || range.lt ? range : null;
}

/**
 * Read-side queries + the tiny partial-QR writes (cancelActivePartialQr). No
 * journal, no money math, no $transaction. Bodies moved VERBATIM from the legacy
 * PaymentsService. Constructed internally by PaymentsService.
 */
@Injectable()
export class PaymentQueryService {
  constructor(private prisma: PrismaService) {}

  // ─── Get payments for a contract ──────────────────────
  async getContractPayments(contractId: string, page = 1, limit = 50) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: { select: { name: true } },
        product: { select: { brand: true, model: true } },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const where = { contractId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { installmentNo: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          recordedBy: { select: { id: true, name: true } },
          waivedApprovedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    // Flatten the waiver approver (relation "PaymentWaivedApprovedBy") to
    // `waivedApprovedByName` — the receipt-history modal's ผู้อนุมัติ column.
    const enriched = data.map(({ waivedApprovedBy, ...p }) => ({
      ...p,
      waivedApprovedByName: waivedApprovedBy?.name ?? null,
    }));

    // `contract` block is additive (existing callers read `.data`) — drives the
    // modal header + the "งวดที่ชำระแล้ว" / "เครดิต" summary cards.
    return {
      ...paginatedResponse(enriched, total, page, limit),
      contract: {
        contractNumber: contract.contractNumber,
        customerName: contract.customer?.name ?? null,
        productName: contract.product ? `${contract.product.brand} ${contract.product.model}` : null,
        totalMonths: contract.totalMonths,
        advanceBalance: contract.advanceBalance,
      },
    };
  }

  // ─── Get posted journal entries for a contract's payment events ──────────
  /**
   * Returns POSTED JEs behind the payment-history modal's receipt rows.
   * There is NO FK from Payment/Receipt → JournalEntry; the canonical link is
   * `metadata.paymentId` (same soft-link ReceiptVoidService queries by). We
   * fetch per-CONTRACT (one query for the whole modal) via `metadata.contractId`,
   * which every relevant flow stamps:
   *   - tag 'receipt'  — PaymentReceiptTemplate (current primitive, full+partial)
   *   - tag '2B'       — legacy pre-primitive receipt JEs
   *   - tag 'credit-allocation' — legacy credit-balance application
   *   - tag 'overpayment-credit' — auto-allocate overpay leg (Dr cash / Cr 21-5101);
   *     shares paymentId with the receipt JE so the row's JEs tie to cash received
   *   - flow 'early-payoff'     — JP4 (its receipt has paymentId = null)
   * Receipt-void REVERSAL JEs carry NO contractId/paymentId — they are fetched
   * in a second pass via metadata.originalEntryId pointing at the entries above,
   * so a voided receipt's ledger effect (original + mirror) is fully visible.
   * Frontend matches rows → JEs by `paymentId` (flow for EARLY_PAYOFF,
   * originalEntryId for CREDIT_NOTE rows).
   * Money is emitted as .toFixed(2) STRINGS (never Number()).
   */
  async getContractJournalEntries(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const lineSelect = {
      where: { deletedAt: null },
      orderBy: { id: 'asc' as const },
      select: { accountCode: true, debit: true, credit: true, description: true },
    };

    const byContract = { path: ['contractId'], equals: contractId };
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        status: 'POSTED',
        deletedAt: null,
        OR: [
          { AND: [{ metadata: byContract }, { metadata: { path: ['tag'], equals: 'receipt' } }] },
          { AND: [{ metadata: byContract }, { metadata: { path: ['tag'], equals: '2B' } }] },
          { AND: [{ metadata: byContract }, { metadata: { path: ['tag'], equals: 'credit-allocation' } }] },
          { AND: [{ metadata: byContract }, { metadata: { path: ['tag'], equals: 'overpayment-credit' } }] },
          { AND: [{ metadata: byContract }, { metadata: { path: ['flow'], equals: 'early-payoff' } }] },
        ],
      },
      include: { lines: lineSelect },
      orderBy: { postedAt: 'asc' },
    });

    // Second pass: receipt-void reversal JEs (tag 'REVERSAL', flow 'receipt-void')
    // stamp ONLY { originalEntryId, originalEntryNumber } — no contractId — so
    // they are only reachable through the ids of the entries found above.
    const reversals = entries.length
      ? await this.prisma.journalEntry.findMany({
          where: {
            status: 'POSTED',
            deletedAt: null,
            OR: entries.map((e) => ({
              metadata: { path: ['originalEntryId'], equals: e.id },
            })),
          },
          include: { lines: lineSelect },
          orderBy: { postedAt: 'asc' },
        })
      : [];
    const allEntries = [...entries, ...reversals];

    // JournalLine.accountCode is a plain string (no CoA relation) — resolve
    // display names in one lookup, fallback to the code itself.
    const codes = [...new Set(allEntries.flatMap((e) => e.lines.map((l) => l.accountCode)))];
    const coaRows = codes.length
      ? await this.prisma.chartOfAccount.findMany({
          where: { code: { in: codes } },
          select: { code: true, name: true },
        })
      : [];
    const nameByCode = new Map(coaRows.map((r) => [r.code, r.name]));

    return allEntries.map((e) => {
      const meta = (e.metadata ?? {}) as Record<string, unknown>;
      let totalDebit = new Prisma.Decimal(0);
      let totalCredit = new Prisma.Decimal(0);
      // JournalLine has no lineNo and its id is a random UUID, so DB order is
      // arbitrary — present Dr lines before Cr (stable sort keeps each group's
      // relative order), matching the Dr-then-Cr convention of every JE view.
      const orderedLines = [...e.lines].sort(
        (a, b) => (b.debit.gt(0) ? 1 : 0) - (a.debit.gt(0) ? 1 : 0),
      );
      const lines = orderedLines.map((l) => {
        totalDebit = totalDebit.plus(l.debit);
        totalCredit = totalCredit.plus(l.credit);
        return {
          accountCode: l.accountCode,
          accountName: nameByCode.get(l.accountCode) ?? l.accountCode,
          debit: l.debit.toFixed(2),
          credit: l.credit.toFixed(2),
          description: l.description ?? '',
        };
      });
      return {
        id: e.id,
        entryNumber: e.entryNumber,
        entryDate: e.entryDate,
        postedAt: e.postedAt,
        description: e.description,
        paymentId: typeof meta.paymentId === 'string' ? meta.paymentId : null,
        tag: typeof meta.tag === 'string' ? meta.tag : null,
        flow: typeof meta.flow === 'string' ? meta.flow : null,
        deltaApplied: typeof meta.deltaApplied === 'string' ? meta.deltaApplied : null,
        lateFeePortion: typeof meta.lateFeePortion === 'string' ? meta.lateFeePortion : null,
        // Receipt-void trail: originals get reversed=true + the mirror's number;
        // reversal JEs point back via originalEntryId (CREDIT_NOTE row matching).
        reversed: meta.reversed === true,
        reversedByEntryNumber:
          typeof meta.reversedByEntryNumber === 'string' ? meta.reversedByEntryNumber : null,
        originalEntryId: typeof meta.originalEntryId === 'string' ? meta.originalEntryId : null,
        lines,
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        isBalanced: totalDebit.toFixed(2) === totalCredit.toFixed(2),
      };
    });
  }

  // ─── Get all pending payments (for payment queue view) ─
  async getPendingPayments(filters: {
    branchId?: string;
    date?: string;
    dueFrom?: string;
    dueTo?: string;
    status?: string;
    search?: string;
    dunningStage?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (filters.status) {
      where.status = filters.status;
    } else {
      where.status = { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] };
    }

    // Build contract filter object to combine multiple conditions
    // Only show payments for APPROVED contracts (not DRAFT/CREATING/PENDING_REVIEW)
    const contractWhere: Record<string, unknown> = {
      workflowStatus: 'APPROVED',
      deletedAt: null,
    };

    if (filters.branchId) {
      contractWhere.branchId = filters.branchId;
    }

    if (filters.dunningStage) {
      contractWhere.dunningStage = filters.dunningStage;
    }

    if (filters.search) {
      const search = filters.search.trim();
      contractWhere.OR = [
        { contractNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search } } },
      ];
    }

    // Always apply contract filter (at minimum: workflowStatus + deletedAt)
    where.contract = contractWhere;

    if (filters.date) {
      const d = new Date(filters.date);
      where.dueDate = {
        gte: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        lt: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
      };
    } else {
      // Period filter (รับชำระค่างวด redesign): scope the queue by installment
      // due-date window. `dueFrom`/`dueTo` are BKK local YYYY-MM-DD; `dueTo` is
      // inclusive (we add a day and use `lt`). Either bound may be omitted.
      const range = buildDueDateRange(filters.dueFrom, filters.dueTo);
      if (range) where.dueDate = range;
    }

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { installmentNo: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          contract: {
            select: {
              id: true,
              contractNumber: true,
              totalMonths: true,
              monthlyPayment: true,
              advanceBalance: true,
              customer: { select: { id: true, name: true, phone: true } },
              branch: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    // Live late fee: Payment.lateFee is a stamp refreshed only at record time /
    // by the overdue cron, so recompute it from current config on read. This keeps
    // the queue + RecordPaymentWizard in step with settings edits and matches what
    // the orchestrator will actually charge. (getDailySummary keeps the stored
    // value — that is the real charged fee on PAID installments.)
    const cfg = await loadLateFeeConfig(this.prisma);
    const now = new Date();
    const withLiveFee = data.map((p) => ({
      ...p,
      lateFee: resolveLivePaymentLateFee(p, cfg, now),
    }));

    return paginatedResponse(withLiveFee, total, page, limit);
  }

  // ─── Pending-queue KPI summary (รับชำระค่างวด redesign) ─────────────────
  // Whole-system aggregate (NOT page-limited) scoped by installment due-date
  // window + branch. Powers the 6 KPI cards above the payment queue. Each
  // figure maps to a real ledger code so collectors see the accounting impact:
  //   outstandingPrincipal  ค่างวดที่ยังไม่เก็บ (amountDue − amountPaid)
  //   outstandingLateFee     → Cr 42-1103 (ค่าปรับชำระล่าช้า) once collected
  //   waivedLateFee          → Dr 52-1105 (ส่วนลด/อนุโลมค่าปรับ)
  //   overdue60Count         → trigger 21-2103 (VAT บังคับ-ลูกหนี้ค้าง 60 วัน)
  //   collected*             ยอด/รายการที่เก็บได้แล้วของงวดในช่วงนี้
  async getPendingSummary(filters: {
    branchId?: string;
    dueFrom?: string;
    dueTo?: string;
  }) {
    // Only count APPROVED contracts — mirrors getPendingPayments so the cards
    // and the list never disagree.
    const contractWhere: Record<string, unknown> = {
      workflowStatus: 'APPROVED',
      deletedAt: null,
    };
    if (filters.branchId) contractWhere.branchId = filters.branchId;

    const range = buildDueDateRange(filters.dueFrom, filters.dueTo);
    const dueDate = range ?? undefined;

    const PENDING_STATUSES: PaymentStatus[] = [
      PaymentStatus.PENDING,
      PaymentStatus.OVERDUE,
      PaymentStatus.PARTIALLY_PAID,
    ];
    const UNPAID_OVERDUE_STATUSES: PaymentStatus[] = [
      PaymentStatus.OVERDUE,
      PaymentStatus.PARTIALLY_PAID,
    ];

    // 60-day cutoff (date-only, server local = BKK in prod). A due date on or
    // before this is "ค้าง ≥ 60 วัน". Combined with the period window's upper
    // bound, so picking "เดือนนี้" correctly yields 0 (nothing due this month
    // can be 60 days overdue yet).
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 60);
    const overdueDueDate: Record<string, unknown> = { ...(dueDate ?? {}), lte: cutoff };

    const pendingWhere = { deletedAt: null, status: { in: PENDING_STATUSES }, contract: contractWhere, ...(dueDate ? { dueDate } : {}) };

    const [pending, waived, overdue60Count, collected, pendingRows, cfg] = await Promise.all([
      // Pending bucket: count + outstanding principal (late fee computed live below)
      this.prisma.payment.aggregate({
        where: pendingWhere,
        _count: true,
        _sum: { amountDue: true, amountPaid: true },
      }),
      // Waived bucket: late fees written down (อนุโลม) — any status
      this.prisma.payment.aggregate({
        where: { deletedAt: null, lateFeeWaived: true, contract: contractWhere, ...(dueDate ? { dueDate } : {}) },
        _sum: { waivedAmount: true },
      }),
      // Overdue ≥ 60 days bucket: still-unpaid installments past the cutoff
      this.prisma.payment.count({
        where: { deletedAt: null, status: { in: UNPAID_OVERDUE_STATUSES }, contract: contractWhere, dueDate: overdueDueDate },
      }),
      // Collected bucket: money actually received for installments due in range
      this.prisma.payment.aggregate({
        where: { deletedAt: null, amountPaid: { gt: 0 }, contract: contractWhere, ...(dueDate ? { dueDate } : {}) },
        _count: true,
        _sum: { amountPaid: true },
      }),
      // Pending-bucket rows for the LIVE late-fee total (Payment.lateFee is a stale
      // stamp — recompute from current config so the KPI matches the queue rows).
      this.prisma.payment.findMany({
        where: pendingWhere,
        select: { dueDate: true, amountDue: true, lateFeeWaived: true },
      }),
      loadLateFeeConfig(this.prisma),
    ]);

    const dec = (v: Prisma.Decimal | number | null | undefined) =>
      new Prisma.Decimal(v ?? 0);
    const outstandingPrincipal = dec(pending._sum?.amountDue)
      .sub(dec(pending._sum?.amountPaid))
      .toDecimalPlaces(2)
      .toNumber();

    const now = new Date();
    const outstandingLateFee = pendingRows
      .reduce(
        (sum, p) => sum.add(resolveLivePaymentLateFee(p, cfg, now)),
        new Prisma.Decimal(0),
      )
      .toDecimalPlaces(2)
      .toNumber();

    return {
      pendingCount: pending._count,
      // เฉพาะค่างวด — amountDue excludes lateFee by schema, so this is the
      // installment principal+interest+vat remaining, never the penalty.
      outstandingPrincipal: Math.max(0, outstandingPrincipal),
      outstandingLateFee,
      waivedLateFee: dec(waived._sum?.waivedAmount).toDecimalPlaces(2).toNumber(),
      overdue60Count,
      collectedAmount: dec(collected._sum?.amountPaid).toDecimalPlaces(2).toNumber(),
      collectedCount: collected._count,
    };
  }

  // ─── Daily summary ────────────────────────────────────
  async getDailySummary(date: string, branchId?: string, page = 1, limit = 50) {
    const d = new Date(date);
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

    const where: Record<string, unknown> = {
      paidDate: { gte: startOfDay, lt: endOfDay },
      status: 'PAID',
      deletedAt: null,
    };

    if (branchId) {
      where.contract = { branchId };
    }

    const [payments, total, aggregation] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: {
          contract: {
            select: {
              contractNumber: true,
              customer: { select: { name: true } },
              branch: { select: { name: true } },
            },
          },
          recordedBy: { select: { name: true } },
        },
        orderBy: { paidDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({
        where,
        _sum: { amountPaid: true, lateFee: true },
      }),
    ]);

    // Compute byMethod from the current page (for display) — summary totals use aggregate
    const byMethod: Record<string, number> = {};
    payments.forEach((p) => {
      const method = p.paymentMethod || 'UNKNOWN';
      byMethod[method] = roundBaht(
        new Prisma.Decimal(byMethod[method] ?? 0)
          .add(new Prisma.Decimal(p.amountPaid ?? 0))
          .toNumber(),
      );
    });

    // W6 fix: the previous Math.round(Decimal.toNumber()) silently dropped
    // satang on every daily total — a day collecting 152.50 + 99.17 + ...
    // was rounded to whole baht for the summary card. Drop the Math.round
    // and keep two-decimal precision; the UI side already calls .toLocaleString
    // which formats both ints and floats consistently.
    const totalAmount = new Prisma.Decimal(aggregation._sum.amountPaid ?? 0)
      .toDecimalPlaces(2)
      .toNumber();
    const totalLateFees = new Prisma.Decimal(aggregation._sum.lateFee ?? 0)
      .toDecimalPlaces(2)
      .toNumber();
    return {
      date,
      totalPayments: total,
      totalAmount,
      totalLateFees,
      byMethod,
      data: payments,
      total,
      page,
      limit,
    };
  }

  // ─── Get credit balance for a contract ─────────────
  async getCreditBalance(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, contractNumber: true, creditBalance: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    // I1 fix: return as 2-dp string (Decimal precision preserved) instead of
    // Number(...) which silently degrades to IEEE-754 binary float and can
    // drift on large balances. UI parses with parseFloat / formatNumber.
    return {
      creditBalance: new Prisma.Decimal(contract.creditBalance.toString()).toFixed(2),
    };
  }

  // ─── Partial-payment QR (cashier sends QR to customer's LINE) ─────────────
  // Customer pays via PaySolutions PromptPay → webhook auto-records as PARTIAL.
  // The active link powers the "QR ส่งแล้ว" badge in the payments table.

  /** Get the currently-active (un-expired) partial-payment QR link for a payment. */
  async getActivePartialQr(paymentId: string) {
    return this.prisma.partialPaymentLink.findFirst({
      where: {
        paymentId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Cancel the currently-active partial-payment QR link, if one exists. */
  async cancelActivePartialQr(paymentId: string) {
    const link = await this.prisma.partialPaymentLink.findFirst({
      where: { paymentId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!link) throw new NotFoundException('ไม่มี QR ที่กำลังใช้งานอยู่');
    return this.prisma.partialPaymentLink.update({
      where: { id: link.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }
}
