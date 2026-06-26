import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { AuditService } from '../audit/audit.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { AccountRoleService } from '../journal/account-role.service';
import { ProductsService } from '../products/products.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { MdmAutoService } from '../mdm/mdm-auto.service';
import { PromiseService } from '../overdue/promise.service';
import { MdmLockService } from '../overdue/mdm-lock.service';
import { PaymentCase } from './dto/payment.dto';
import { BadDebtService } from '../accounting/bad-debt.service';
import {
  validateBranchAccess as validateBranchAccessHelper,
  validateBranchAccessByPayment as validateBranchAccessByPaymentHelper,
} from './services/payment-helpers';
import { PaymentReceiptOrchestrator } from './services/payment-receipt-orchestrator';
import { LateFeeWaiverService } from './services/late-fee-waiver.service';
import { PaymentQueryService } from './services/payment-query.service';
import { PaymentJournalPreviewService } from './services/payment-journal-preview.service';
import { PaymentCsvImportService } from './services/payment-csv-import.service';
import { PaymentPostCommitHooks } from './services/payment-post-commit-hooks';

/**
 * Facade over the decomposed payments core (the regulated FINANCE money path).
 *
 * Behaviour-preserving decompose of the former 2214-LOC god-service into six
 * plain sub-services + a stateless helper module, constructed INTERNALLY (so the
 * module, the 6 positional construction sites — csv-import.spec + 5 e2e
 * harnesses — and the 3 forwardRef consumers stay untouched: no provider /
 * forwardRef / positional-ctor churn). The 15-method public surface + the EXACT
 * positional ctor (incl. the 4 @Optional tail) are unchanged; every public
 * method one-line delegates.
 *
 *   - {@link PaymentReceiptOrchestrator}  — REGULATED CORE: recordPayment /
 *       autoAllocatePayment / applyCreditBalance, the 3 Serializable money $tx
 *       (receipt JE + VAT-60 reversal + ECL stage-reverse + overpayment
 *       createAndPost) each AS ONE ATOM.
 *   - {@link LateFeeWaiverService}        — waiveLateFee (its own $tx, NO JE).
 *   - {@link PaymentQueryService}         — reads + the partial-QR writes.
 *   - {@link PaymentJournalPreviewService}— previewJournal (read-only JE builder).
 *   - {@link PaymentCsvImportService}     — importPaymentsFromCsv (row-by-row via
 *       host.recordPayment → the facade, so each row gets the full money $tx).
 *   - {@link PaymentPostCommitHooks}      — checkPromiseAfterPayment (own $tx,
 *       post-commit) + awardLoyaltyPoints + sendPaymentSuccessLine.
 *
 * Sub-services are built LAZILY on first use (not in the ctor): the orchestrator
 * + CSV importer route their cross-seam dispatch (post-commit hooks / row-by-row
 * recordPayment) through host arrows that resolve `this.<method>` at CALL time,
 * so a spy installed on the facade AFTER construction (csv-import.spec,
 * payments.service.spec) is still honoured.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  private _services?: {
    orchestrator: PaymentReceiptOrchestrator;
    waiver: LateFeeWaiverService;
    query: PaymentQueryService;
    preview: PaymentJournalPreviewService;
    csvImport: PaymentCsvImportService;
    postCommit: PaymentPostCommitHooks;
  };

  constructor(
    private prisma: PrismaService,
    private receiptsService: ReceiptsService,
    private auditService: AuditService,
    private journalAutoService: JournalAutoService,
    private productsService: ProductsService,
    private lineOaService: LineOaService,
    private flexTemplates: FlexTemplatesService,
    private quickReplyService: QuickReplyService,
    // BadDebtService is REQUIRED — ECL stage reverse on payment is a
    // regulatory requirement (NPAEs Ch.13). Failure to load the dependency
    // must break boot, not silently skip the reverse. Kept above the
    // @Optional() params per TS rule (required cannot follow optional).
    private badDebtService: BadDebtService,
    // PR-843/I2 Phase 3 3a — recordPayment now posts the receipt via the
    // PaymentReceiptTemplate primitive (replacing the legacy 2B in this path).
    // Both are REQUIRED — the receipt JE + the VAT-60-day reversal are
    // regulatory ledger postings; a missing dependency must break boot, not
    // silently skip a posting. Positioned above @Optional() params per the TS
    // rule (required cannot follow optional).
    private paymentReceiptTemplate: PaymentReceiptTemplate,
    private vat60Reversal: Vat60dayReversalTemplate,
    @Optional() private mdmAuto?: MdmAutoService,
    @Optional() @Inject(forwardRef(() => PromiseService)) private promiseService?: PromiseService,
    @Optional() private mdmLockService?: MdmLockService,
    /**
     * D1.1.6.1 + D1.1.6.2 — resolves `adj_underpay` / `adj_overpay` → CoA code
     * via account_role_map for the JE preview path. Optional to match the
     * resilient pattern used for `mdmAuto` / `mdmLockService`; when missing,
     * falls back to spec defaults (52-1104 for underpay, 53-1503 for overpay)
     * which match the seed rows.
     */
    @Optional() private accountRoleService?: AccountRoleService,
  ) {}

  /**
   * Lazily build (once) and return the decomposed sub-services. The
   * orchestrator + CSV importer receive host objects whose arrows dispatch back
   * through `this` (the facade) so post-construction spies + the @Optional
   * mdmAuto / promiseService fields resolve at call time.
   */
  private services() {
    if (!this._services) {
      const postCommit = new PaymentPostCommitHooks(
        this.prisma,
        this.promiseService,
        this.mdmLockService,
        this.lineOaService,
        this.flexTemplates,
        this.quickReplyService,
      );
      const orchestrator = new PaymentReceiptOrchestrator(
        this.prisma,
        this.receiptsService,
        this.auditService,
        this.journalAutoService,
        this.productsService,
        this.badDebtService,
        this.paymentReceiptTemplate,
        this.vat60Reversal,
        {
          awardLoyaltyPoints: (customerId, contractId, paymentId, amount, paidDate, dueDate) =>
            this.awardLoyaltyPoints(customerId, contractId, paymentId, amount, paidDate, dueDate),
          sendPaymentSuccessLine: (contractId, installmentNo, amount, paymentMethod) =>
            this.sendPaymentSuccessLine(contractId, installmentNo, amount, paymentMethod),
          runMdmAutoUnlock: (contractId) => this.runMdmAutoUnlock(contractId),
          checkPromiseAfterPayment: (contractId) => this.checkPromiseAfterPayment(contractId),
        },
      );
      const waiver = new LateFeeWaiverService(this.prisma, this.auditService, this.productsService);
      const query = new PaymentQueryService(this.prisma);
      const preview = new PaymentJournalPreviewService(this.prisma, this.accountRoleService);
      const csvImport = new PaymentCsvImportService(this.prisma, {
        recordPayment: (
          contractId,
          installmentNo,
          amount,
          paymentMethod,
          recordedById,
          evidenceUrl,
          notes,
          transactionRef,
          depositAccountCode,
          toleranceApproverId,
          paymentCase,
        ) =>
          this.recordPayment(
            contractId,
            installmentNo,
            amount,
            paymentMethod,
            recordedById,
            evidenceUrl,
            notes,
            transactionRef,
            depositAccountCode,
            toleranceApproverId,
            paymentCase,
          ),
      });
      this._services = { orchestrator, waiver, query, preview, csvImport, postCommit };
    }
    return this._services;
  }

  /** Enforce branch-level access: SALES/BRANCH_MANAGER can only operate on their own branch */
  async validateBranchAccess(
    contractId: string,
    user: { role: string; branchId: string | null },
  ) {
    return validateBranchAccessHelper(this.prisma, contractId, user);
  }

  /**
   * W1 fix: enforce branch-level access when the caller only knows the
   * paymentId (waive-late-fee + partial-QR endpoints).
   */
  async validateBranchAccessByPayment(
    paymentId: string,
    user: { role: string; branchId: string | null },
  ) {
    return validateBranchAccessByPaymentHelper(this.prisma, paymentId, user);
  }

  // ─── Record a single payment (บังคับ upload หลักฐาน) ──
  async recordPayment(
    contractId: string,
    installmentNo: number,
    amount: number,
    paymentMethod: string,
    recordedById: string,
    evidenceUrl?: string,
    notes?: string,
    transactionRef?: string,
    depositAccountCode?: string,
    toleranceApproverId?: string,
    paymentCase?: PaymentCase,
    consumeAdvance: boolean = true,
    paidDate?: Date,
    lateFeeWaiverAmount?: number,
    lateFeeWaiverReasonCode?: string,
    waiverApproverId?: string,
  ) {
    return this.services().orchestrator.recordPayment(
      contractId,
      installmentNo,
      amount,
      paymentMethod,
      recordedById,
      evidenceUrl,
      notes,
      transactionRef,
      depositAccountCode,
      toleranceApproverId,
      paymentCase,
      consumeAdvance,
      paidDate,
      lateFeeWaiverAmount,
      lateFeeWaiverReasonCode,
      waiverApproverId,
    );
  }

  // ─── Phase 4: draft/post split (บันทึก Draft → ลงบัญชี) ─────────────────────
  // A payment is DRAFT iff it has a live PaymentDraft row. No money moves while a
  // draft exists — posting reads the params and runs the normal recordPayment flow.

  /** Save/replace the unposted draft receipt for an installment (no JE, no money movement). */
  async saveDraft(
    contractId: string,
    installmentNo: number,
    params: {
      amount: number;
      paymentMethod: string;
      depositAccountCode?: string;
      lateFee?: number;
      lateFeeWaiverAmount?: number;
      lateFeeWaiverReasonCode?: string;
      waiverApproverId?: string;
      consumeAdvance?: boolean;
      paidDate?: string;
      paymentCase?: PaymentCase;
      transactionRef?: string;
      evidenceUrl?: string;
      notes?: string;
    },
    createdById: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { contractId, installmentNo, deletedAt: null },
    });
    if (!payment) throw new NotFoundException('ไม่พบงวดที่ต้องการ');
    if (payment.status === 'PAID') throw new BadRequestException('งวดนี้ชำระแล้ว');

    const data = {
      amount: new Prisma.Decimal(params.amount.toString()),
      paymentMethod: params.paymentMethod,
      depositAccountCode: params.depositAccountCode ?? null,
      lateFee: params.lateFee != null ? new Prisma.Decimal(params.lateFee.toString()) : null,
      lateFeeWaiverAmount:
        params.lateFeeWaiverAmount != null ? new Prisma.Decimal(params.lateFeeWaiverAmount.toString()) : null,
      lateFeeWaiverReasonCode: params.lateFeeWaiverReasonCode ?? null,
      waiverApproverId: params.waiverApproverId ?? null,
      consumeAdvance: params.consumeAdvance ?? true,
      paidDate: params.paidDate ? new Date(params.paidDate) : null,
      paymentCase: params.paymentCase ?? null,
      transactionRef: params.transactionRef ?? null,
      evidenceUrl: params.evidenceUrl ?? null,
      notes: params.notes ?? null,
      createdById,
    };
    return this.prisma.paymentDraft.upsert({
      where: { paymentId: payment.id },
      create: { paymentId: payment.id, ...data },
      update: { ...data, deletedAt: null }, // re-drafting after a cancel un-deletes
    });
  }

  /** The live draft for a payment (null if none). */
  async getDraft(paymentId: string) {
    return this.prisma.paymentDraft.findFirst({ where: { paymentId, deletedAt: null } });
  }

  /** Discard a draft (back to plain PENDING). */
  async cancelDraft(paymentId: string) {
    const draft = await this.prisma.paymentDraft.findFirst({ where: { paymentId, deletedAt: null } });
    if (!draft) throw new NotFoundException('ไม่พบฉบับร่าง');
    await this.prisma.paymentDraft.update({ where: { id: draft.id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  /** Post a draft: run the normal recordPayment money flow, then retire the draft.
   *  `postedById` is the user who clicked ลงบัญชี (the checker); the payment's
   *  `recordedById` is the draft CREATOR (the maker) so the 4-eyes SoD guard
   *  (waiverApproverId ≠ recordedById) still holds when the approver posts. */
  async postDraft(paymentId: string, postedById: string) {
    const draft = await this.prisma.paymentDraft.findFirst({ where: { paymentId, deletedAt: null } });
    if (!draft) throw new NotFoundException('ไม่พบฉบับร่าง');
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.deletedAt) throw new NotFoundException('ไม่พบงวดที่ต้องการ');
    void postedById; // checker identity captured at the HTTP/audit layer; maker records the payment

    const result = await this.recordPayment(
      payment.contractId,
      payment.installmentNo,
      Number(draft.amount),
      draft.paymentMethod,
      draft.createdById, // recordedById = the maker (draft creator), preserves SoD vs waiver approver
      draft.evidenceUrl ?? undefined,
      draft.notes ?? undefined,
      draft.transactionRef ?? undefined,
      draft.depositAccountCode ?? undefined,
      undefined, // toleranceApproverId — drafts don't carry tolerance approval
      (draft.paymentCase as PaymentCase | null) ?? undefined,
      draft.consumeAdvance,
      draft.paidDate ?? undefined,
      draft.lateFeeWaiverAmount != null ? Number(draft.lateFeeWaiverAmount) : undefined,
      draft.lateFeeWaiverReasonCode ?? undefined,
      draft.waiverApproverId ?? undefined,
    );

    // Retire the draft once posted (best-effort; a re-post is blocked by the
    // "งวดนี้ชำระแล้ว" guard in recordPayment, so a lingering draft can't double-post).
    await this.prisma.paymentDraft.update({ where: { id: draft.id }, data: { deletedAt: new Date() } });
    return result;
  }

  // ─── Auto-allocate payment to next pending installment ─
  async autoAllocatePayment(
    contractId: string,
    amount: number,
    paymentMethod: string,
    recordedById: string,
    notes?: string,
    evidenceUrl?: string,
  ) {
    return this.services().orchestrator.autoAllocatePayment(
      contractId,
      amount,
      paymentMethod,
      recordedById,
      notes,
      evidenceUrl,
    );
  }

  // ─── Get payments for a contract ──────────────────────
  async getContractPayments(contractId: string, page = 1, limit = 50) {
    return this.services().query.getContractPayments(contractId, page, limit);
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
    return this.services().query.getPendingPayments(filters);
  }

  // ─── Pending-queue KPI summary (whole-system aggregate) ─
  async getPendingSummary(filters: { branchId?: string; dueFrom?: string; dueTo?: string }) {
    return this.services().query.getPendingSummary(filters);
  }

  // ─── Daily summary ────────────────────────────────────
  async getDailySummary(date: string, branchId?: string, page = 1, limit = 50) {
    return this.services().query.getDailySummary(date, branchId, page, limit);
  }

  // ─── Apply credit balance to next pending installment ─
  async applyCreditBalance(contractId: string, recordedById: string) {
    return this.services().orchestrator.applyCreditBalance(contractId, recordedById);
  }

  // ─── Get credit balance for a contract ─────────────
  async getCreditBalance(contractId: string) {
    return this.services().query.getCreditBalance(contractId);
  }

  // ─── Batch CSV Payment Import ────────────────────────
  async importPaymentsFromCsv(
    csvText: string,
    defaultPaymentMethod: string,
    recordedById: string,
    bodyDepositAccountCode?: string,
  ): Promise<{ total: number; success: number; errors: { row: number; message: string }[] }> {
    return this.services().csvImport.importPaymentsFromCsv(
      csvText,
      defaultPaymentMethod,
      recordedById,
      bodyDepositAccountCode,
    );
  }

  // ─── Waive late fee (wrapped in transaction to prevent race condition) ─
  async waiveLateFee(
    paymentId: string,
    reason: string,
    userId: string,
    approverId: string,
    context?: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    return this.services().waiver.waiveLateFee(paymentId, reason, userId, approverId, context);
  }

  // ─── T3-C5: Preventive immutability guard ───────────────
  /**
   * T3-C5: PREVENTIVE RULE.
   *
   * `Payment.amountPaid` is a financial fact — once money has been recorded
   * against an installment, the correct remediation for an error is to
   * REVERSE the bad entry (create a negative/offsetting record) and book a
   * NEW payment with the correct amount. Silently mutating `amountPaid`
   * would erase the audit trail used by accountants to reconcile bank
   * statements against Payment rows.
   *
   * Today no endpoint calls this method — it exists specifically to trap
   * future code that tries to patch Payment fields directly. If you find
   * yourself wanting to bypass it, stop and write a reversal instead.
   *
   * Forbidden fields (will throw):
   *   - amountPaid
   *   - amountDue
   *   - status (use recordPayment / waiveLateFee / reversePayment instead)
   *   - paidDate
   *   - monthlyPrincipal / monthlyInterest / monthlyCommission / vatAmount
   *
   * Safe fields (`notes`, `evidenceUrl`) are routed through dedicated
   * helpers elsewhere — this method does NOT write them.
   */
  async updatePayment(
    _paymentId: string,
    patch: Record<string, unknown>,
  ): Promise<never> {
    const FORBIDDEN_FIELDS = new Set([
      'amountPaid',
      'amountDue',
      'status',
      'paidDate',
      'monthlyPrincipal',
      'monthlyInterest',
      'monthlyCommission',
      'vatAmount',
      'lateFee',
    ]);
    const violated = Object.keys(patch).filter((k) => FORBIDDEN_FIELDS.has(k));
    const violationMsg =
      violated.length > 0
        ? `ห้ามแก้ไข field การเงินของ Payment โดยตรง (${violated.join(', ')}) ` +
          'กรุณาใช้ reversePayment() + บันทึกรายการชำระใหม่แทน'
        : 'ห้ามแก้ไข Payment ผ่าน updatePayment() — กรุณาใช้ recordPayment() / ' +
          'waiveLateFee() / reversePayment() ตามกรณี';
    throw new ForbiddenException(violationMsg);
  }

  // ─── Partial-payment QR (cashier sends QR to customer's LINE) ─────────────

  /** Get the currently-active (un-expired) partial-payment QR link for a payment. */
  async getActivePartialQr(paymentId: string) {
    return this.services().query.getActivePartialQr(paymentId);
  }

  /** Cancel the currently-active partial-payment QR link, if one exists. */
  async cancelActivePartialQr(paymentId: string) {
    return this.services().query.cancelActivePartialQr(paymentId);
  }

  /**
   * Preview JE lines for a payment without persisting anything.
   * Used by the RecordPaymentWizard frontend to show "Journal Auto" live.
   */
  async previewJournal(input: {
    contractId: string;
    installmentNo: number;
    amountReceived: number;
    depositAccountCode: string;
    lateFee?: number;
    lateFeeWaived?: number;
    case?: string;
    daysToShift?: number;
    splitMode?: string;
    consumeAdvance?: boolean;
  }) {
    return this.services().preview.previewJournal(input);
  }

  // ─── Post-commit hooks (run OUTSIDE the money tx — I3 ordering) ────────────
  // Kept as facade methods so the existing specs that spy/call them on the
  // facade (and read service['promiseService'] / service['mdmLockService'])
  // stay green; they delegate to PaymentPostCommitHooks.

  private async awardLoyaltyPoints(
    customerId: string,
    contractId: string,
    paymentId: string,
    amount: number,
    paidDate: Date | null,
    dueDate: Date,
  ) {
    return this.services().postCommit.awardLoyaltyPoints(
      customerId,
      contractId,
      paymentId,
      amount,
      paidDate,
      dueDate,
    );
  }

  private async sendPaymentSuccessLine(
    contractId: string,
    installmentNo: number,
    amount: number,
    paymentMethod: string,
  ): Promise<void> {
    return this.services().postCommit.sendPaymentSuccessLine(
      contractId,
      installmentNo,
      amount,
      paymentMethod,
    );
  }

  /**
   * M3 fix: only run the legacy "all overdue cleared" auto-unlock when there
   * is no active promise-to-pay cycle. When there is an active promise, the
   * checkPromiseAfterPayment hook handles the unlock via its own CYCLE_KEPT
   * path — running both racied two unlock requests per payment.
   */
  private async runMdmAutoUnlock(contractId: string): Promise<void> {
    if (this.mdmAuto) {
      const hasActivePromise =
        !!this.promiseService && !!(await this.promiseService.findActivePromise(contractId));
      if (!hasActivePromise) {
        this.mdmAuto.autoUnlockAfterPayment(contractId).catch((err) =>
          this.logger.error('MDM auto-unlock failed', err),
        );
      }
    }
  }

  // ─── Promise-to-pay kept-detection ────────────────────
  // Kept on the facade (private) because payments.service.spec calls it
  // directly via `service.checkPromiseAfterPayment(...)` (@ts-expect-error
  // access private). Delegates to PaymentPostCommitHooks.
  private async checkPromiseAfterPayment(contractId: string): Promise<void> {
    return this.services().postCommit.checkPromiseAfterPayment(contractId);
  }
}
