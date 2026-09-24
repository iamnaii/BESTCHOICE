import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../../receipts/receipt-types.constants';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { paginatedResponse } from '../../../common/helpers/pagination.helper';
import { roundBaht } from '../../../utils/installment.util';
import { loadLateFeeConfig, resolveLivePaymentLateFee } from '../../../utils/late-fee.util';
import { collectAccountCodes, toContractJeView } from '../../journal/contract-je-view.util';
import { loadLateFeePaidByPaymentIds, loadPostedPaymentReceiptTotals } from './payment-late-fee-paid.util';

/**
 * Build a Prisma `dueDate` range filter from BKK-local YYYY-MM-DD bounds.
 * `dueTo` is INCLUSIVE — we add one day and use `lt` so the whole end day is
 * covered. Returns `null` when neither bound is supplied (= "ทั้งหมด", no
 * filter). Bad/empty inputs are ignored gracefully.
 */
function buildDueDateRange(dueFrom?: string, dueTo?: string): { gte?: Date; lt?: Date } | null {
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
/**
 * Contract statuses the payment orchestrator will accept a receipt for — mirror of
 * the guard in payment-receipt-orchestrator.ts ("สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE
 * หรือ DEFAULT"). The queue lists only these (owner 2026-09-05): TERMINATED
 * (บอกเลิกแล้ว — ยึดเครื่องจากหน้ายึดคืน), CLOSED_BAD_DEBT and EXCHANGED never retire
 * their unpaid Payment rows, so without this scope they sat in รับชำระ as dead rows
 * nobody could act on. Keep in sync with the orchestrator — never widen one alone.
 */
const PAYABLE_CONTRACT_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT'] as const;
const UNPAID_PAYMENT_STATUSES = ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'];
/** No status, or an unpaid one, = the queue proper. status=PAID = the ชำระครบ history tab. */
const isUnpaidListing = (status?: string) => !status || UNPAID_PAYMENT_STATUSES.includes(status);

/** เหตุการณ์ปิดสัญญา — ดู resolveClosure */
export interface ContractClosure {
  kind: 'DEVICE_RETURN' | 'EARLY_PAYOFF' | 'COMPLETED' | 'CANCELED';
  at: Date;
  /** ยอดปิดสัญญาที่ลูกค้าจ่าย/ควรจ่าย (ยึดคืน = closingAmount · ปิดยอด = ยอดใบเสร็จ) */
  amount: string | null;
  /** ราคาประเมินที่หน้าร้านรับเครื่อง (ยึดคืนเท่านั้น) */
  appraisalPrice: string | null;
  /** เลขใบรับเครื่องคืน DR-… (ยึดคืน) */
  docNumber: string | null;
  /** เลขใบเสร็จ EARLY_PAYOFF (ปิดยอด) */
  receiptNumber: string | null;
  /** JE ที่ปิดสัญญา (JP4 / JP5) — เปิดในกล่องบันทึกบัญชีของหน้าประวัติ */
  entryNumber: string | null;
  byName: string | null;
}

@Injectable()
export class PaymentQueryService {
  constructor(private prisma: PrismaService) {}

  // ─── Get payments for a contract ──────────────────────
  /**
   * เหตุการณ์ปิดสัญญาสำหรับหน้า "ประวัติการชำระ" (เจ้าของ 2026-09-24: "ไม่มีประวัติว่าลูกค้าปิดยอด / คืนเครื่อง")
   * หน้านั้นเรียงจากใบเสร็จ — คืนเครื่อง/ยึดคืน (JP5) ไม่ออกใบเสร็จ จึงต้องอ่านจากแถวยึด + ใบรับเครื่องคืน;
   * ปิดยอดก่อนกำหนดอ่านจากใบเสร็จ EARLY_PAYOFF; ผ่อนครบ/ยกเลิก = สถานะสัญญา. null = สัญญายังเดินอยู่
   */
  private async resolveClosure(contract: {
    id: string;
    status: string;
    updatedAt: Date;
  }): Promise<ContractClosure | null> {
    const byContract = { path: ['contractId'], equals: contract.id };
    const entryNumberOf = async (flow: string) =>
      (
        await this.prisma.journalEntry.findFirst({
          where: {
            status: 'POSTED',
            deletedAt: null,
            AND: [{ metadata: byContract }, { metadata: { path: ['flow'], equals: flow } }],
          },
          orderBy: { postedAt: 'desc' },
          select: { entryNumber: true },
        })
      )?.entryNumber ?? null;
    const userName = async (id: string | null | undefined) =>
      id
        ? ((await this.prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name ??
          null)
        : null;
    const empty = {
      amount: null,
      appraisalPrice: null,
      docNumber: null,
      receiptNumber: null,
      entryNumber: null,
      byName: null,
    };

    // แถวยึด = ยืนยันรับเครื่องคืนแล้ว (JP5 ลงบัญชี) — มาก่อนสถานะ เพราะสัญญาเป็น CLOSED_BAD_DEBT ทั้งจากยึดและตัดหนี้สูญ
    const repossession = await this.prisma.repossession.findFirst({
      where: { contractId: contract.id, deletedAt: null },
      select: {
        repossessedDate: true,
        closingAmount: true,
        appraisalPrice: true,
        appraisedBy: { select: { name: true } },
        deviceReturn: { select: { docNumber: true, confirmedAt: true, confirmedById: true } },
      },
    });
    if (repossession) {
      return {
        ...empty,
        kind: 'DEVICE_RETURN',
        at: repossession.deviceReturn?.confirmedAt ?? repossession.repossessedDate,
        amount: repossession.closingAmount?.toString() ?? null,
        appraisalPrice: repossession.appraisalPrice.toString(),
        docNumber: repossession.deviceReturn?.docNumber ?? null,
        entryNumber: await entryNumberOf('repossession'),
        byName:
          (await userName(repossession.deviceReturn?.confirmedById)) ??
          repossession.appraisedBy?.name ??
          null,
      };
    }
    if (contract.status === 'EARLY_PAYOFF') {
      const receipt = await this.prisma.receipt.findFirst({
        where: { contractId: contract.id, receiptType: 'EARLY_PAYOFF', isVoided: false, deletedAt: null },
        orderBy: { paidDate: 'desc' },
        select: { receiptNumber: true, amount: true, paidDate: true, issuedById: true },
      });
      return {
        ...empty,
        kind: 'EARLY_PAYOFF',
        at: receipt?.paidDate ?? contract.updatedAt,
        amount: receipt?.amount.toString() ?? null,
        receiptNumber: receipt?.receiptNumber ?? null,
        entryNumber: await entryNumberOf('early-payoff'),
        byName: await userName(receipt?.issuedById),
      };
    }
    if (contract.status === 'COMPLETED') return { ...empty, kind: 'COMPLETED', at: contract.updatedAt };
    if (contract.status === 'CANCELED') return { ...empty, kind: 'CANCELED', at: contract.updatedAt };
    return null;
  }

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
        productName: contract.product
          ? `${contract.product.brand} ${contract.product.model}`
          : null,
        totalMonths: contract.totalMonths,
        advanceBalance: contract.advanceBalance,
        rescheduleAdvanceBalance: contract.rescheduleAdvanceBalance,
        status: contract.status,
        closure: await this.resolveClosure(contract),
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
          {
            AND: [
              { metadata: byContract },
              { metadata: { path: ['tag'], equals: 'credit-allocation' } },
            ],
          },
          {
            AND: [
              { metadata: byContract },
              { metadata: { path: ['tag'], equals: 'overpayment-credit' } },
            ],
          },
          {
            AND: [
              { metadata: byContract },
              { metadata: { path: ['flow'], equals: 'early-payoff' } },
            ],
          },
          // คืนเครื่อง/ยึดคืน (JP5) — แถว "ปิดสัญญาแล้ว" ของหน้าประวัติเปิดดูบันทึกบัญชีจากที่นี่ (2026-09-24)
          {
            AND: [
              { metadata: byContract },
              { metadata: { path: ['flow'], equals: 'repossession' } },
            ],
          },
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
    const codes = collectAccountCodes(allEntries);
    const coaRows = codes.length
      ? await this.prisma.chartOfAccount.findMany({
          where: { code: { in: codes } },
          select: { code: true, name: true },
        })
      : [];
    const nameByCode = new Map(coaRows.map((r) => [r.code, r.name]));

    // Shared mapper (journal/contract-je-view.util) — same shape as
    // GET /contracts/:id/journal-entries so the web JeBlock renders both.
    return allEntries.map((e) => toContractJeView(e, nameByCode));
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

    // Unpaid listings show only contracts a receipt can still be recorded on.
    // The PAID history tab is NOT scoped — paid installments of a contract that
    // later closed (COMPLETED/TERMINATED/...) must stay visible.
    if (isUnpaidListing(filters.status)) {
      contractWhere.status = { in: [...PAYABLE_CONTRACT_STATUSES] };
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
              rescheduleAdvanceBalance: true,
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
    // PAID rows keep the STORED fee — that is the fee actually charged at
    // record time. Recomputing from (now − dueDate) would show a fictitious
    // fee on installments that were paid on time but are viewed after the
    // due date (ชำระครบ tab, status=PAID queries).
    //
    // Waived rows must surface the NET fee the customer actually owed: the
    // wizard's gross-waiver convention (PR #1313) keeps Payment.lateFee at
    // GROSS (Cr 42-1103) and records the discount in waivedAmount (Dr
    // 52-1105) — returning the gross fee would make the row read as an
    // underpayment. Clamped at 0 because the standalone waiver flow zeroes
    // lateFee AND sets waivedAmount, so an unclamped subtraction goes negative.
    const netStoredFee = (p: {
      lateFee: Prisma.Decimal;
      lateFeeWaived: boolean;
      waivedAmount: Prisma.Decimal | null;
    }) =>
      p.lateFeeWaived
        ? Prisma.Decimal.max(0, new Prisma.Decimal(p.lateFee).sub(p.waivedAmount ?? 0))
        : p.lateFee;
    // ห้ามข้ามงวด (owner 2026-08-19): flag rows that are NOT their contract's
    // earliest unpaid installment so the UI can disable รับชำระ up front.
    // Computed against the DATABASE, not this page — a due-date window can show
    // งวด 3 while the unpaid งวด 2 sits outside the filter. One groupBy over the
    // page's contracts; the recording-time guard in the orchestrator remains the
    // authoritative enforcement.
    const contractIds = [...new Set(data.map((p) => p.contract.id))];
    const minUnpaidByContract = new Map<string, number>();
    if (contractIds.length > 0) {
      const mins = await this.prisma.payment.groupBy({
        by: ['contractId'],
        where: {
          contractId: { in: contractIds },
          status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
          deletedAt: null,
        },
        _min: { installmentNo: true },
      });
      for (const m of mins) {
        if (m._min.installmentNo != null) minUnpaidByContract.set(m.contractId, m._min.installmentNo);
      }
    }

    // Payment.amountPaid measures installment settlement and includes credits.
    // The paid list separately shows cash on active installment receipts, including
    // a bundled reschedule's overage. RESCHEDULE_FEE belongs to its own receipt,
    // not the current installment. Missing receipt evidence stays unavailable.
    const paidPaymentIds = data.filter((p) => p.status === 'PAID').map((p) => p.id);
    const receiptCashByPayment = new Map<string, string>();
    if (paidPaymentIds.length > 0) {
      const receiptSums = await this.prisma.receipt.groupBy({
        by: ['paymentId'],
        where: {
          paymentId: { in: paidPaymentIds },
          receiptType: { in: [...INSTALLMENT_MONEY_RECEIPT_TYPES] },
          isVoided: false,
          deletedAt: null,
        },
        _sum: { amount: true },
      });
      for (const row of receiptSums) {
        if (row.paymentId && row._sum.amount !== null)
          receiptCashByPayment.set(row.paymentId, row._sum.amount.toFixed(2));
      }
    }

    const { lateFeePaid: lateFeePaidByPayment, knownReceiptCash } =
      await loadPostedPaymentReceiptTotals(this.prisma, data.map(p => p.id));
    for (const [paymentId, receiptCash] of receiptCashByPayment) {
      // Issuance is post-commit: one partial receipt can be absent even when
      // other receipts exist. Never present that known incomplete sum as cash.
      if (knownReceiptCash.get(paymentId)?.gt(new Prisma.Decimal(receiptCash))) {
        receiptCashByPayment.delete(paymentId);
      }
    }
    const withLiveFee = data.map((p) => ({
      ...p,
      lateFee: p.status === 'PAID' ? netStoredFee(p) : resolveLivePaymentLateFee(p, cfg, now),
      lateFeePaid: (lateFeePaidByPayment.get(p.id) ?? new Prisma.Decimal(0)).toFixed(2),
      ...(p.status === 'PAID' ? { receiptCashAmount: receiptCashByPayment.get(p.id) ?? null } : {}),
      hasEarlierUnpaid:
        p.status !== 'PAID' &&
        p.installmentNo > (minUnpaidByContract.get(p.contract.id) ?? p.installmentNo),
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
  async getPendingSummary(filters: { branchId?: string; dueFrom?: string; dueTo?: string }) {
    // Only count APPROVED contracts — mirrors getPendingPayments so the cards
    // and the list never disagree.
    const contractWhere: Record<string, unknown> = {
      workflowStatus: 'APPROVED',
      deletedAt: null,
    };
    if (filters.branchId) contractWhere.branchId = filters.branchId;
    // Unpaid buckets (queue count, outstanding, ≥60d) use the same contract-status
    // scope as getPendingPayments so the cards never disagree with the list.
    // Collected/waived describe money that already moved — left unscoped.
    const unpaidContractWhere: Record<string, unknown> = {
      ...contractWhere,
      status: { in: [...PAYABLE_CONTRACT_STATUSES] },
    };

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

    const pendingWhere = {
      deletedAt: null,
      status: { in: PENDING_STATUSES },
      contract: unpaidContractWhere,
      ...(dueDate ? { dueDate } : {}),
    };

    const [pending, waived, overdue60Count, collected, pendingRows, cfg] = await Promise.all([
      // Pending bucket: count + outstanding principal (late fee computed live below)
      this.prisma.payment.aggregate({
        where: pendingWhere,
        _count: true,
        _sum: { amountDue: true, amountPaid: true },
      }),
      // Waived bucket: late fees written down (อนุโลม) — any status
      this.prisma.payment.aggregate({
        where: {
          deletedAt: null,
          lateFeeWaived: true,
          contract: contractWhere,
          ...(dueDate ? { dueDate } : {}),
        },
        _sum: { waivedAmount: true },
      }),
      // Overdue ≥ 60 days bucket: still-unpaid installments past the cutoff
      this.prisma.payment.count({
        where: {
          deletedAt: null,
          status: { in: UNPAID_OVERDUE_STATUSES },
          contract: unpaidContractWhere,
          dueDate: overdueDueDate,
        },
      }),
      // Collected bucket: money actually received for installments due in range
      this.prisma.payment.aggregate({
        where: {
          deletedAt: null,
          amountPaid: { gt: 0 },
          contract: contractWhere,
          ...(dueDate ? { dueDate } : {}),
        },
        _count: true,
        _sum: { amountPaid: true },
      }),
      // Pending-bucket rows for the LIVE late-fee total (Payment.lateFee is a stale
      // stamp — recompute from current config so the KPI matches the queue rows).
      this.prisma.payment.findMany({
        where: pendingWhere,
        select: { id: true, dueDate: true, amountDue: true, amountPaid: true, lateFee: true, lateFeeWaived: true },
      }),
      loadLateFeeConfig(this.prisma),
    ]);

    const lateFeePaidByPayment = await loadLateFeePaidByPaymentIds(this.prisma, pendingRows.map(p => p.id));
    const feePaid = pendingRows.reduce(
      (sum, p) => sum.plus(lateFeePaidByPayment.get(p.id) ?? 0), new Prisma.Decimal(0),
    );
    const dec = (v: Prisma.Decimal | number | null | undefined) => new Prisma.Decimal(v ?? 0);
    // amountPaid includes collected fees; restore that portion before calculating
    // the installment balance, then subtract it from the fee balance below.
    const outstandingPrincipal = dec(pending._sum?.amountDue)
      .sub(dec(pending._sum?.amountPaid))
      .plus(feePaid)
      .toDecimalPlaces(2)
      .toNumber();

    const now = new Date();
    const outstandingLateFee = pendingRows
      .reduce((sum, p) => sum.add(Prisma.Decimal.max(
        resolveLivePaymentLateFee(p, cfg, now).minus(lateFeePaidByPayment.get(p.id) ?? 0), 0,
      )), new Prisma.Decimal(0))
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
  /**
   * สรุปรายวัน — **เงินสดที่รับจริงในวันนั้น**, one row per RECEIPT.
   *
   * Sourced from `Receipt`, not `Payment`. `Payment.amountPaid` is the
   * OBLIGATION CLEARED on an installment, which is a different number from the
   * cash that crossed the counter whenever a 21-1103 advance is created or
   * consumed: paying 3,800 on a 3,671 + 100 installment records amountPaid =
   * 3,771 and parks 29 as advance; the next installment then records 3,771
   * while only 3,742 in cash arrived. A tab whose KPI card reads
   * "แยกตามวิธี → เงินสด" must report the cash. (Prod contract
   * TEST-20260809-004, งวด 2 — reported 2026-08-18.)
   *
   * Three further consequences of the old `Payment` source, all fixed by the
   * switch rather than by extra code here:
   *   - `Payment.paidDate` is set ONLY when the installment closes
   *     (`payment-receipt-orchestrator.ts`: `paidDate: isPaidInFull ? … : null`),
   *     so a partial payment's cash was invisible on the day it was received
   *     and then landed in full on the closing day;
   *   - N receipts against one installment collapsed into ONE row, so
   *     "จำนวนรายการ" undercounted the day's transactions;
   *   - down payments, early payoffs and reschedule fees never appeared at all
   *     (no `Payment.paidDate` of their own) — they do now.
   *
   * Scope: non-voided, non-CREDIT_NOTE receipts. This is the same "money
   * collected" definition the payment-history modal's ยอดชำระสะสม card already
   * uses (`computeCumulativePaid`), so the two agree by construction. A void
   * therefore restates the day it corrects — which is what the owner wants to
   * see, and is already true regardless: a re-issued receipt is backdated to
   * the real cash date (D4), not to the day it was re-keyed.
   */
  async getDailySummary(date: string, branchId?: string, page = 1, limit = 50) {
    const d = new Date(date);
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

    const where: Prisma.ReceiptWhereInput = {
      paidDate: { gte: startOfDay, lt: endOfDay },
      isVoided: false,
      deletedAt: null,
      // A credit note carries the ORIGINAL receipt's POSITIVE amount, so counting
      // it would double the day instead of cancelling it. The void it documents
      // already removed the original via `isVoided`.
      receiptType: { not: 'CREDIT_NOTE' },
      ...(branchId ? { contract: { branchId } } : {}),
    };

    const [receipts, total, aggregation, methodGroups, dayPaymentRefs] = await Promise.all([
      this.prisma.receipt.findMany({
        where,
        select: {
          id: true,
          receiptNumber: true,
          receiptType: true,
          amount: true,
          installmentNo: true,
          paymentId: true,
          paymentMethod: true,
          paidDate: true,
          issuedById: true,
          contract: {
            select: {
              contractNumber: true,
              customer: { select: { name: true } },
              branch: { select: { name: true } },
            },
          },
        },
        orderBy: { paidDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.receipt.count({ where }),
      this.prisma.receipt.aggregate({ where, _sum: { amount: true } }),
      // Grouped over the WHOLE day. The previous implementation accumulated
      // byMethod from the current PAGE while totalAmount came from the aggregate,
      // so the two KPI cards silently disagreed on any day past `limit` rows.
      this.prisma.receipt.groupBy({ by: ['paymentMethod'], where, _sum: { amount: true } }),
      // Distinct installments settled today — also whole-day, not page-scoped.
      this.prisma.receipt.findMany({ where, select: { paymentId: true }, distinct: ['paymentId'] }),
    ]);

    const byMethod: Record<string, number> = {};
    for (const group of methodGroups) {
      const method = group.paymentMethod || 'UNKNOWN';
      byMethod[method] = new Prisma.Decimal(group._sum.amount ?? 0).toDecimalPlaces(2).toNumber();
    }

    // Late fee lives on the INSTALLMENT (Payment.lateFee), not on the receipt, so
    // it is counted once per distinct installment even when two receipts cleared
    // it. Net of the waiver, using the same convention as the history modal's
    // computeFeeTotals: an explicit `waivedAmount` wins, otherwise
    // `lateFeeWaived` means the whole gross fee was waived (legacy rows).
    // `distinct` above dedupes at the DB, the Set dedupes again in code — the
    // fee must be counted once per installment even if that clause ever moves.
    const paymentIds = [
      ...new Set(dayPaymentRefs.map((r) => r.paymentId).filter((id): id is string => id != null)),
    ];
    const feeRows = paymentIds.length
      ? await this.prisma.payment.findMany({
          where: { id: { in: paymentIds } },
          select: { lateFee: true, lateFeeWaived: true, waivedAmount: true },
        })
      : [];
    const totalLateFees = feeRows
      .reduce((acc, p) => {
        const gross = new Prisma.Decimal(p.lateFee ?? 0);
        const waived =
          p.waivedAmount != null
            ? new Prisma.Decimal(p.waivedAmount)
            : p.lateFeeWaived
              ? gross
              : new Prisma.Decimal(0);
        return acc.plus(gross.minus(waived));
      }, new Prisma.Decimal(0))
      .toDecimalPlaces(2)
      .toNumber();

    // Receipt has no `issuedBy` relation in the schema — batch-resolve the names
    // in one query, same pattern as ReceiptQueryService.getContractReceipts.
    const issuerIds = [...new Set(receipts.map((r) => r.issuedById).filter(Boolean))];
    const issuers = issuerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: issuerIds } },
          select: { id: true, name: true },
        })
      : [];
    const issuerName = new Map(issuers.map((u) => [u.id, u.name]));

    // W6 fix (kept): 2-dp precision preserved — a day collecting 152.50 + 99.17
    // must not round to whole baht for the summary card.
    const totalAmount = new Prisma.Decimal(aggregation._sum.amount ?? 0)
      .toDecimalPlaces(2)
      .toNumber();

    return {
      date,
      totalPayments: total,
      totalAmount,
      totalLateFees,
      byMethod,
      data: receipts.map((r) => ({
        ...r,
        issuedByName: issuerName.get(r.issuedById) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * "วันไหนมีสมุดบ้าง" — days of one month that hold money receipts, powering the
   * clickable date chips under the สรุปรายวัน picker (owner 2026-08-19: the bare
   * date input forced the cashier to guess which days had data).
   *
   * Same universe as getDailySummary by construction (non-voided, non-CN),
   * bucketed by the SAME server-local day boundary the per-day filter uses — a
   * day listed here always renders a non-empty summary when clicked.
   */
  async getDailySummaryDates(month: string, branchId?: string) {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    const year = m ? Number(m[1]) : NaN;
    const mon = m ? Number(m[2]) : NaN;
    if (!m || mon < 1 || mon > 12) {
      throw new BadRequestException('รูปแบบเดือนไม่ถูกต้อง (ต้องเป็น YYYY-MM)');
    }

    const receipts = await this.prisma.receipt.findMany({
      where: {
        paidDate: { gte: new Date(year, mon - 1, 1), lt: new Date(year, mon, 1) },
        isVoided: false,
        deletedAt: null,
        receiptType: { not: 'CREDIT_NOTE' },
        ...(branchId ? { contract: { branchId } } : {}),
      },
      select: { paidDate: true, amount: true },
    });

    const byDay = new Map<string, { count: number; total: Prisma.Decimal }>();
    for (const r of receipts) {
      const d = r.paidDate;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`;
      const cur = byDay.get(key) ?? { count: 0, total: new Prisma.Decimal(0) };
      byDay.set(key, { count: cur.count + 1, total: cur.total.plus(r.amount) });
    }

    return {
      month,
      days: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, count: v.count, total: v.total.toDecimalPlaces(2).toNumber() })),
    };
  }

  /**
   * ส่งออก Excel แบบช่วงวัน (owner 2026-08-19: "ต้องเลือกช่วงวันก่อน") — every
   * money receipt of an INCLUSIVE from–to window in one call, for the client-side
   * exceljs export. Same universe as getDailySummary (non-voided, non-CN) so the
   * exported rows always reconcile with the on-screen daily totals.
   *
   * Caps: window <= 186 days (same convention as the PEAK journal export) and
   * 10,000 rows (truncated flag — exceljs in the browser, not a data dump API).
   */
  async getDailySummaryExport(from: string, to: string, branchId?: string) {
    const parse = (v: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      if (!m) return null;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return isNaN(d.getTime()) ? null : d;
    };
    const start = parse(from);
    const endDay = parse(to);
    if (!start || !endDay) {
      throw new BadRequestException('รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
    }
    if (endDay < start) {
      throw new BadRequestException('ช่วงวันไม่ถูกต้อง — วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น');
    }
    const DAY_MS = 24 * 60 * 60 * 1000;
    if ((endDay.getTime() - start.getTime()) / DAY_MS > 186) {
      throw new BadRequestException('ช่วงวันยาวเกิน 186 วัน — กรุณาแบ่งส่งออกเป็นช่วงสั้นลง');
    }
    // Inclusive end -> start of the NEXT day (same boundary math as the day view).
    const end = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() + 1);

    const ROW_CAP = 10_000;
    const receipts = await this.prisma.receipt.findMany({
      where: {
        paidDate: { gte: start, lt: end },
        isVoided: false,
        deletedAt: null,
        receiptType: { not: 'CREDIT_NOTE' },
        ...(branchId ? { contract: { branchId } } : {}),
      },
      select: {
        id: true,
        receiptNumber: true,
        receiptType: true,
        amount: true,
        installmentNo: true,
        paymentMethod: true,
        paidDate: true,
        issuedById: true,
        contract: {
          select: {
            contractNumber: true,
            customer: { select: { name: true } },
            branch: { select: { name: true } },
          },
        },
      },
      orderBy: { paidDate: 'asc' },
      take: ROW_CAP + 1,
    });
    const truncated = receipts.length > ROW_CAP;
    const page = truncated ? receipts.slice(0, ROW_CAP) : receipts;

    const issuerIds = [...new Set(page.map((r) => r.issuedById).filter(Boolean))];
    const issuers = issuerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: issuerIds } },
          select: { id: true, name: true },
        })
      : [];
    const issuerName = new Map(issuers.map((u) => [u.id, u.name]));

    return {
      from,
      to,
      total: page.length,
      truncated,
      rows: page.map((r) => ({ ...r, issuedByName: issuerName.get(r.issuedById) ?? null })),
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
