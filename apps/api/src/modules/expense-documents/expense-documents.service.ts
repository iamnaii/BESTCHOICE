import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ADJUSTMENT_ALLOWLIST } from './expense-validators.util';
import { CreateExpenseDocumentDto } from './dto/create.dto';
import { UpdateExpenseDocumentDto } from './dto/update.dto';
import { ListExpenseDocumentsQueryDto } from './dto/list-query.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { CreatePettyCashDto } from './dto/create-petty-cash.dto';
import { VoidExpenseDocumentDto } from './dto/void-expense.dto';
import { ExpenseDocumentQueryService } from './services/expense-document-query.service';
import { ExpenseDocumentLifecycleService } from './services/expense-document-lifecycle.service';
import { ExpenseDocumentCreateService } from './services/expense-document-create.service';

@Injectable()
export class ExpenseDocumentsService implements OnModuleInit {
  private readonly logger = new Logger(ExpenseDocumentsService.name);

  /**
   * W1 (Round 2) — Boot-time validation that every ADJUSTMENT_ALLOWLIST code
   * actually exists (active, not deleted) in chart_of_accounts. Pattern
   * mirrors AccountRoleService.assertCodesExistInCoa. Without this, a CoA
   * rename or soft-delete would let the allow-list silently reference a
   * dead account and a preparer could still pick it. Boot fails loud so
   * the drift is caught before the first doc posts.
   */
  async onModuleInit(): Promise<void> {
    const codes = [...ADJUSTMENT_ALLOWLIST];
    const found = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true },
    });
    const foundSet = new Set(found.map((c) => c.code));
    const missing = codes.filter((c) => !foundSet.has(c));
    if (missing.length > 0) {
      throw new Error(
        `ExpenseDocumentsService: ADJUSTMENT_ALLOWLIST references ` +
          `${missing.length} code(s) not present (or soft-deleted) in ` +
          `chart_of_accounts: ${missing.join(', ')}. Either seed the ` +
          `accounts or update the allow-list constant.`,
      );
    }
    this.logger.log(
      `[W1] Adjustment allow-list verified: ${codes.length} codes present in CoA`,
    );
  }

  constructor(
    private readonly prisma: PrismaService,
    // Phase 1 decompose — the 9 READ-only methods now live in
    // ExpenseDocumentQueryService; the facade delegates. Owns `jePreview`
    // (previously a facade param).
    private readonly query: ExpenseDocumentQueryService,
    // Phase 2a decompose — submitForApproval / softDelete (+ the private
    // notifyApprovers fan-out) now live in ExpenseDocumentLifecycleService;
    // the facade delegates. The lifecycle service OWNS the NotificationsService
    // dependency (the facade no longer references it directly).
    private readonly lifecycle: ExpenseDocumentLifecycleService,
    // Phase 3 decompose — the CREATE-FAMILY + `update` methods now live in
    // ExpenseDocumentCreateService; the facade delegates. The create service
    // OWNS docNumber / aggregator / transition / ssoConfig / pettyCash /
    // payrollCustom (the facade no longer references them directly).
    private readonly creator: ExpenseDocumentCreateService,
  ) {}


  // ─── Create ──────────────────────────────────────────────────────────
  // Phase 3 decompose — delegates to ExpenseDocumentCreateService.
  async create(dto: CreateExpenseDocumentDto, userId: string) {
    return this.creator.create(dto, userId);
  }

  // ─── SP5 Phase 2 — Repair-ticket auto-doc helper ──────────────────────────
  /**
   * Creates a DRAFT ExpenseDocument of type REPAIR_SERVICE within an existing
   * transaction. Called by RepairTicketsService.returnToCustomer() (payer=SHOP
   * path) so the repair cost doc and the ticket state-flip land atomically.
   *
   * Design notes:
   * - Takes a `Prisma.TransactionClient` so the entire returnToCustomer flow
   *   is a single atomic unit — no partial state if doc creation fails.
   * - `amount` is accepted as `Prisma.Decimal` to keep full precision across
   *   the module boundary (no Number() drift).
   * - Skips the CoA-type guard (5x-xxxx "ค่าใช้จ่าย" check) because the
   *   account code comes from SystemConfig, not from user input. Validated at
   *   configuration time by the OWNER.
   * - Skips the multi-line adjustment validation (V12/V13/V14) — single-line
   *   doc with no adjustments.
   */
  async createDraftForRepair(
    dto: {
      vendorName: string;
      vendorSupplierId?: string;
      amount: Prisma.Decimal;
      accountCode: string;
      description: string;
      branchId: string;
      createdById: string;
      metadata: Record<string, unknown>;
    },
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    // Phase 3 decompose — delegates to ExpenseDocumentCreateService (passes the
    // caller's tx through; the create service opens NO new transaction here).
    return this.creator.createDraftForRepair(dto, tx);
  }

  // ─── Credit Note create (validates + computes totals from lines) ──────────
  // C4 · 2-Mode:
  //   - LINKED (default): full path with original lookup, advisory lock, cap
  //     check, branch match, no-WHT guard.
  //   - STANDALONE: free-form refund with no source FK. Requires vendorName.
  //     Skips lookup + cap + branch match (no original to match against).
  //     JE template branches on creditNote.mode to omit the original Dr leg.
  // Phase 3 decompose — delegates to ExpenseDocumentCreateService.
  async createCreditNote(dto: CreateCreditNoteDto, userId: string) {
    return this.creator.createCreditNote(dto, userId);
  }

  // ─── Payroll create — multi-line, computes netPaid per line ──────────
  // Phase 3 decompose — delegates to ExpenseDocumentCreateService.
  async createPayroll(
    dto: CreatePayrollDto,
    user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    return this.creator.createPayroll(dto, user);
  }

  // ─── Vendor Settlement create — multi-line clears ACCRUAL EXs ────────
  // Phase 3 decompose — delegates to ExpenseDocumentCreateService.
  async createSettlement(
    dto: CreateSettlementDto,
    user: { id: string; branchId?: string | null; role?: string },
  ) {
    return this.creator.createSettlement(dto, user);
  }

  // ─── Petty Cash create (C1) — multi-supplier single-doc ──────────────
  // Phase 3 decompose — delegates to ExpenseDocumentCreateService.
  async createPettyCash(
    dto: CreatePettyCashDto,
    user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    return this.creator.createPettyCash(dto, user);
  }

  // ─── List ────────────────────────────────────────────────────────────
  // Phase 1 decompose — delegates to ExpenseDocumentQueryService.
  async list(
    query: ListExpenseDocumentsQueryDto,
    user: { branchId?: string | null; role?: string },
  ) {
    return this.query.list(query, user);
  }

  // ─── Summary aggregations ────────────────────────────────────────────
  // Phase 1 decompose — delegates to ExpenseDocumentQueryService.
  async getSummary(filters: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    return this.query.getSummary(filters);
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
   *
   * Phase 1 decompose — delegates to ExpenseDocumentQueryService.
   */
  async getTaxDisallowedSummary(filters: {
    branchId?: string;
    from?: string;
    to?: string;
  }) {
    return this.query.getTaxDisallowedSummary(filters);
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
   *
   * Phase 1 decompose — delegates to ExpenseDocumentQueryService.
   */
  async getApAging(filters: { branchId?: string; vendor?: string; bucket?: '0-30' | '31-60' | '61-90' | '90+' }) {
    return this.query.getApAging(filters);
  }

  // ─── Daily summary (print-ready aggregation) ─────────────────────────
  // Phase 1 decompose — delegates to ExpenseDocumentQueryService.
  async getDailySummary(
    filters: { date: string; branchId?: string },
    user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    return this.query.getDailySummary(filters, user);
  }

  // ─── Credit-Note remaining cap ───────────────────────────────────────
  // Returns how much CN can still be issued against this original document.
  // cap = original.totalAmount - Σ (non-VOIDED CNs against this original).
  // Phase 1 decompose — delegates to ExpenseDocumentQueryService.
  async getCreditNoteCap(originalDocumentId: string) {
    return this.query.getCreditNoteCap(originalDocumentId);
  }

  // ─── JE Preview (pure — no DB write) ────────────────────────────────
  // Phase 1 decompose — delegates to ExpenseDocumentQueryService.
  async previewJe(dto: CreateExpenseDocumentDto) {
    return this.query.previewJe(dto);
  }

  // ─── Audit trail ─────────────────────────────────────────────────────
  // Immutable event timeline for one expense document, consumed by the shared
  // InternalControlActionBar audit timeline on the ExpenseDetailPage. Mirrors
  // OtherIncomeService.getAuditTrail. Both entity casings are queried for
  // resilience (services write 'expense_document'; defensive include of the
  // PascalCase form in case a future writer / interceptor differs).
  // Phase 1 decompose — delegates to ExpenseDocumentQueryService.
  async getAuditTrail(
    id: string,
    user?: { branchId?: string | null; role?: string | null },
  ) {
    return this.query.getAuditTrail(id, user);
  }

  // ─── Find one ────────────────────────────────────────────────────────
  // I5 — include type-specific detail so single-doc views (PaymentVoucher,
  // CN view, payroll view, SE view) don't need a follow-up roundtrip. The
  // base includes (expenseDetail / branch / approver) work for every type;
  // creditNote / payroll / settlement detail are added based on documentType.
  // Phase 1 decompose — delegates to ExpenseDocumentQueryService.
  async findOne(id: string, viewerRole?: string | null) {
    return this.query.findOne(id, viewerRole);
  }

  // ─── Update (DRAFT only) ─────────────────────────────────────────────
  // Phase 3 decompose — delegates to ExpenseDocumentCreateService.
  async update(id: string, dto: UpdateExpenseDocumentDto, _userId: string) {
    return this.creator.update(id, dto, _userId);
  }

  // ─── Submit for approval (DRAFT → PENDING_APPROVAL) ─────────────────
  // D1.2.1.1 — entry point of the Approval Workflow. Phase 2a decompose:
  // delegated to ExpenseDocumentLifecycleService (which owns the notification
  // fan-out). Signature + behavior unchanged.
  async submitForApproval(id: string, userId: string) {
    return this.lifecycle.submitForApproval(id, userId);
  }

  // ─── Post (DRAFT → ACCRUAL or POSTED) ────────────────────────────────
  // Phase 2b decompose — the JE-posting core (post + the shared inner-tx body
  // executePostBody + approve) now lives in ExpenseDocumentLifecycleService.
  // The facade delegates so the public contract (controller + callers) is
  // unchanged. executePostBody is private to the lifecycle service (shared by
  // post + approve inside their own $transaction).
  async post(id: string, _userId: string, userRole?: string) {
    return this.lifecycle.post(id, _userId, userRole);
  }

  // ─── Approve (PENDING_APPROVAL → APPROVED → optionally POSTED) ────────
  // Phase 2b decompose — delegates to ExpenseDocumentLifecycleService.approve.
  async approve(id: string, userId: string, userRole?: string) {
    return this.lifecycle.approve(id, userId, userRole);
  }

  // ─── Void (any non-VOIDED → VOIDED) ──────────────────────────────────
  // Phase 2c decompose: delegated to ExpenseDocumentLifecycleService.
  // Signature + behavior unchanged.
  async voidDocument(
    id: string,
    userId: string,
    dto: VoidExpenseDocumentDto = {},
    userRole?: string,
  ) {
    return this.lifecycle.voidDocument(id, userId, dto, userRole);
  }

  // ─── Soft delete (DRAFT only) ────────────────────────────────────────
  // Phase 2a decompose: delegated to ExpenseDocumentLifecycleService.
  // Signature + behavior unchanged.
  async softDelete(id: string, _userId: string) {
    return this.lifecycle.softDelete(id, _userId);
  }
}
