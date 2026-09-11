import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Prisma, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  getApprovalRequiredDocTypes,
  getReverseReasons,
} from '../approval-config.util';
import { assertAccountingPermission, assertAccountingBranch, getAccountingPermissions, parseAccountingPermissions, ACCOUNTING_PERMISSIONS_KEY } from '../../../utils/accounting-permissions';
import { canApproveAccountingDoc, SELF_APPROVAL_DENIED_MESSAGE } from '@installment/shared';
import { bkkBusinessDate } from '../bkk-business-date.util';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { readBoolFlag } from '../../../utils/config.util';
import { StatusTransitionService } from './status-transition.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ExpenseSameDayTemplate } from '../../journal/cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from '../../journal/cpa-templates/expense-accrual.template';
import { CreditNoteTemplate } from '../../journal/cpa-templates/credit-note.template';
import { PayrollTemplate } from '../../journal/cpa-templates/payroll.template';
import { VendorSettlementTemplate } from '../../journal/cpa-templates/vendor-settlement.template';
import { PettyCashTemplate } from '../../journal/cpa-templates/petty-cash.template';
import { ShopExpenseTemplate } from '../../journal/cpa-templates/shop-expense.template';
import { VoidExpenseDocumentDto } from '../dto/void-expense.dto';

/**
 * Phase 2 of the transactional-core decompose: the document LIFECYCLE methods of
 * ExpenseDocumentsService, extracted VERBATIM. The facade delegates to this
 * service so the public contract (controller + callers) is unchanged.
 *
 * Complete (Phases 2a/2b/2c): the full document state machine lives here —
 * submitForApproval, notifyApprovers (private), softDelete (2a); post,
 * executePostBody (private), approve (2b); voidDocument (2c) — plus verbatim
 * copies of the private readBoolFlag / readNumberFlag config-flag wrappers.
 *
 * This service OWNS the notifications dependency (the facade sheds it) — the
 * trailing-optional `notifications?` ctor param preserves notifyApprovers'
 * early-return behavior when notifications is not wired (tests can omit it).
 *
 * Behavior-preserving — method bodies are byte-identical to the pre-extraction
 * facade; only import paths were adjusted for the deeper directory.
 */
@Injectable()
export class ExpenseDocumentLifecycleService {
  private readonly logger = new Logger(ExpenseDocumentLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Phase 2b — the StatusTransitionService + 6 JE templates needed by the
    // posting core (post / executePostBody / approve) that moved here verbatim.
    private readonly transition: StatusTransitionService,
    private readonly sameDayTemplate: ExpenseSameDayTemplate,
    private readonly accrualTemplate: ExpenseAccrualTemplate,
    private readonly creditNoteTemplate: CreditNoteTemplate,
    private readonly payrollTemplate: PayrollTemplate,
    private readonly settlementTemplate: VendorSettlementTemplate,
    private readonly pettyCashTemplate: PettyCashTemplate,
    // Phase 2d — ShopExpenseTemplate routes REPAIR_SERVICE docs to the SHOP
    // chart (Cr S21-1103 accrual / S-cash same-day) instead of the generic
    // accrualTemplate which hardcodes the FINANCE Cr 21-1104.
    private readonly shopExpenseTemplate: ShopExpenseTemplate,
    // Phase 2c — the JournalAutoService used by voidDocument's reversal-JE
    // post (this.journal.createAndPost). Placed before the trailing-optional
    // notifications? so the existing param contract stays positional-stable.
    private readonly journal: JournalAutoService,
    private readonly notifications?: NotificationsService,
  ) {}

  // ─── Submit for approval (DRAFT → PENDING_APPROVAL) ─────────────────
  // D1.2.1.1 — entry point of the Approval Workflow. Only callable when
  // SystemConfig `approval_enabled` is true. Without that flag set the
  // legacy lifecycle (DRAFT → POSTED) applies and there's no reason to
  // visit PENDING_APPROVAL.
  //
  // NOTE: this references the new enum values `PENDING_APPROVAL` and
  // `APPROVED` which land on the schema in D1.2.1.6 (sibling PR). Until
  // that migrates, this PR uses `as unknown as DocumentStatus` casts. At
  // merge time accept the conflict on `schema.prisma` from 1.6.
  async submitForApproval(id: string, userId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `post:${id}`);

      const approvalEnabled = await this.readBoolFlag(tx, 'approval_enabled', false);
      if (!approvalEnabled) {
        throw new BadRequestException(
          'ฟีเจอร์ขออนุมัติยังไม่เปิดใช้งาน — กรุณาเปิด SystemConfig `approval_enabled` ก่อน',
        );
      }

      const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
      const { user: actor } = await getAccountingPermissions(tx, userId);
      assertAccountingBranch(actor, doc.branchId);
      if (doc.status !== 'DRAFT') {
        throw new BadRequestException(
          `ส่งขออนุมัติได้เฉพาะเอกสาร DRAFT — สถานะปัจจุบัน ${doc.status}`,
        );
      }

      const PENDING_APPROVAL = 'PENDING_APPROVAL' as unknown as DocumentStatus;
      const result = await tx.expenseDocument.update({
        where: { id },
        data: { status: PENDING_APPROVAL },
      });

      // D1.2.1.5 — APPROVAL_REQUESTED audit log. Atomic with the status flip.
      // PII-safe payload: documentNumber + totalAmount + documentType only.
      // Salary lines, employee tax IDs, etc. NEVER captured here per PDPA.
      await tx.auditLog.create({
        data: {
          action: 'APPROVAL_REQUESTED',
          entity: 'expense_document',
          entityId: id,
          userId,
          oldValue: { status: 'DRAFT' },
          newValue: {
            status: 'PENDING_APPROVAL',
            documentNumber: result.number,
            documentType: result.documentType,
            totalAmount: result.totalAmount.toString(),
            requesterUserId: userId,
          },
        },
      });

      return result;
    });

    // D1.2.1.5 — fan out notifications OUTSIDE the tx. A notification failure
    // must never roll back the status flip already persisted.
    await this.notifyApprovers({
      id: updated.id,
      documentNumber: updated.number,
      documentType: updated.documentType,
      totalAmount: updated.totalAmount,
    });

    return updated;
  }

  /**
   * D1.2.1.5 — Fan out IN_APP notifications to configured approvers when
   * a doc enters PENDING_APPROVAL. Runs OUTSIDE the parent transaction —
   * a notification failure NEVER rolls back the status flip.
   *
   * - Reads `notification_on_pending` (default true) — opt-out per OWNER.
   * - Reads + validates `approvers_list` against the User table.
   * - Falls back to OWNER users when the list is empty (root-of-trust).
   * - Uses `Promise.allSettled` so one bad recipient never blocks the rest.
   * - Errors are logged + swallowed (no rethrow).
   */
  private async notifyApprovers(doc: {
    id: string;
    documentNumber: string;
    documentType: string;
    totalAmount: Prisma.Decimal | string | number;
  }): Promise<void> {
    try {
      const enabled = await this.readBoolFlag(
        this.prisma,
        'notification_on_pending',
        true,
      );
      if (!enabled) return;
      if (!this.notifications) return;

      const [policy, users, document] = await Promise.all([
        this.prisma.systemConfig.findFirst({ where: { key: ACCOUNTING_PERMISSIONS_KEY, deletedAt: null }, select: { value: true } }),
        this.prisma.user.findMany({ where: { isActive: true, deletedAt: null, isSystemUser: false, role: { in: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER'] } }, select: { id: true, role: true, branchId: true } }),
        this.prisma.expenseDocument.findUnique({ where: { id: doc.id }, select: { branchId: true } }),
      ]);
      const grants = parseAccountingPermissions(policy?.value);
      const recipients = users.filter((user) =>
        (user.role === 'OWNER' || grants[user.id]?.includes('EXPENSE_APPROVE')) &&
        (user.role !== 'BRANCH_MANAGER' || (!!user.branchId && user.branchId === document?.branchId)),
      ).map((user) => user.id);
      if (recipients.length === 0) return;

      const totalStr = new Prisma.Decimal(doc.totalAmount.toString()).toFixed(2);
      const message =
        `เอกสาร ${doc.documentNumber} (${doc.documentType}) ` +
        `ยอด ${totalStr} บาท รออนุมัติ`;

      await Promise.allSettled(
        recipients.map((userId) =>
          this.notifications!.send({
            channel: 'IN_APP',
            recipient: userId,
            subject: 'มีเอกสารรออนุมัติ',
            message,
            relatedId: doc.id,
          }),
        ),
      );
    } catch (err) {
      // Log and swallow — notification failure must NOT roll back the
      // status flip already persisted in the parent transaction.
      this.logger.warn(
        `notifyApprovers(${doc.id}) failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── Soft delete (DRAFT only) ────────────────────────────────────────
  async softDelete(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { user: actor } = await assertAccountingPermission(tx, userId, 'EXPENSE_CANCEL');
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `post:${id}`);
      const existing = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      assertAccountingBranch(actor, existing.branchId);
      if (existing.status !== 'DRAFT' || existing.deletedAt) {
        throw new BadRequestException('ลบได้เฉพาะเอกสารร่างที่ยังไม่ถูกยกเลิก');
      }
      const deleted = await tx.expenseDocument.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({ data: {
        action: 'DELETED', entity: 'expense_document', entityId: id, userId,
        oldValue: { status: 'DRAFT' }, newValue: { deletedAt: deleted.deletedAt },
      } });
      return deleted;
    });
  }

  // ─── Post (DRAFT → ACCRUAL or POSTED) ────────────────────────────────
  // D1.2.1.1 — when `approval_enabled` is true, DRAFT documents must first
  // be submitted via `submitForApproval()`. Posting straight from DRAFT is
  // rejected so the approval signature is never bypassed. When false, the
  // legacy DRAFT → POSTED path is preserved.
  // D1.2.1.6 — also accepts APPROVED → POSTED (when approval_enabled is on
  // AND auto_post_on_approve is false, OWNER manually calls post() on an
  // APPROVED doc; assertCanPost permits both DRAFT + APPROVED).
  async post(id: string, _userId: string, _userRole?: string) {
    return this.prisma.$transaction(async (tx) => {
      const { user: actor } = await assertAccountingPermission(tx, _userId, 'EXPENSE_POST');
      // Per-doc advisory lock — serializes concurrent post calls on the same id.
      // Without this, two callers could both read DRAFT, both pass assertCanPost,
      // and both run the JE template → two journal entries for one document
      // (same race class as voidDocument).
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `post:${id}`);

      const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
      assertAccountingBranch(actor, doc.branchId);

      // D1.2.1.2 — approval gate (threshold OR doctype filter).
      //
      // The gate fires when SystemConfig `approval_enabled` is true (sibling
      // PR D1.2.1.1) AND the doc is DRAFT AND EITHER of:
      //   (a) doc.totalAmount >= SystemConfig `approval_threshold`
      //       (default 50,000 ฿; negatives clamp to 0 so a malformed config
      //       can never accidentally short-circuit the gate to "always on")
      //   (b) doc.documentType is in SystemConfig `approval_required_doc_types`
      //       (default `['PAYROLL']` — hardcoded here; once #932 merges the
      //       SystemConfig value takes over for the same OR-composed gate)
      //
      // OR semantics ensure low-value payroll still requires approval, and a
      // high-value EX still gets gated even if not in the doctype list.
      //
      // Source-status check (`DRAFT`) keeps APPROVED docs flowing through —
      // a doc that has already passed approval should not be re-checked here.
      const approvalEnabled = await this.readBoolFlag(tx, 'approval_enabled', false);
      if (approvalEnabled && doc.status === 'DRAFT') {
        const threshold = await this.readNumberFlag(tx, 'approval_threshold', 50000);
        const docTotal = new Prisma.Decimal(doc.totalAmount.toString());
        const overThreshold = docTotal.gte(threshold);

        // D1.2.1.4 — doc-type filter via `getApprovalRequiredDocTypes` helper.
        // Reads SystemConfig key `approval_required_doc_types` (JSON array),
        // filters to valid DocumentType enum values, defaults to ['PAYROLL']
        // on missing/malformed rows.
        const requiredDocTypes = await getApprovalRequiredDocTypes(tx);
        const isRequiredType = requiredDocTypes.includes(doc.documentType);

        if (overThreshold || isRequiredType) {
          throw new BadRequestException(
            'เอกสารต้องผ่านการอนุมัติก่อน — กรุณากด "ส่งขออนุมัติ"',
          );
        }
      }

      this.transition.assertCanPost({
        type: doc.documentType,
        from: doc.status,
        hasPaymentMethod: !!doc.paymentMethod && !!doc.depositAccountCode,
        totalAmount: doc.totalAmount.toString(),
      });

      if (doc.status === 'DRAFT') {
        await tx.expenseDocument.update({ where: { id }, data: { approvedById: null } });
      }
      const result = await this.executePostBody(doc, tx);
      await tx.auditLog.create({ data: {
        action: 'POSTED', entity: 'expense_document', entityId: id, userId: _userId,
        oldValue: { status: doc.status }, newValue: { postedById: _userId },
      } });
      return result;
    });
  }

  /**
   * Shared post body — period guard, attachment threshold, WHT routing,
   * JE template dispatch. Called from both post() (after assertCanPost) and
   * approve() (after assertCanApprove + status flip to APPROVED, when
   * auto_post_on_approve is true).
   *
   * Pure refactor extracted to eliminate ~150 LOC of drift-prone duplication
   * (see deep-review finding Group 3 #1). Behaviour is identical to the inline
   * blocks it replaces — caller is responsible for:
   *   • advisory lock acquisition
   *   • doc load + deletedAt check
   *   • transition assertion (assertCanPost / assertCanApprove)
   *   • status flip + APPROVED audit (approve path only)
   *   • AUTO_POSTED audit after success (approve path only)
   *
   * Returns the JE template result (`{ journalEntryId, ... }` shape varies
   * by template) so the caller can propagate it.
   */
  private async executePostBody(
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    doc: Prisma.ExpenseDocumentGetPayload<{}>,
    tx: Prisma.TransactionClient,
  ): Promise<unknown> {
    const id = doc.id;

    // Fix #C9 (Round 2 — moved from journal-auto.service.createAndPost):
    // Period-open guard at the module boundary. Previously the guard lived
    // inside createAndPost, which broke payment + contract atomicity (it
    // would reject mid-tx JE writes and roll back the Payment record).
    // The guard belongs HERE because:
    //   1. We know the canonical posting date — doc.documentDate, not
    //      "now" (which would let a backdated post slip through if the
    //      clock crossed midnight between create + post).
    //   2. We know the canonical companyId — SHOP (all expense flows post
    //      SHOP-side per accounting.md §VAT Policy; expense template
    //      resolves SHOP later, this guard mirrors that).
    // Resolve the period-guard company. Default = SHOP (all expense flows
    // post SHOP-side per accounting.md §VAT Policy). PAYROLL is scope-aware
    // (คำสั่งเจ้าของ 2026-08-06): a FINANCE-scope payroll posts its JE under
    // the FINANCE company, so its period guard must check the FINANCE
    // AccountingPeriod — guarding SHOP's period for a FINANCE JE would let a
    // closed FINANCE month be reopened through payroll by accident.
    let periodCompanyCode: 'SHOP' | 'FINANCE' = 'SHOP';
    if (doc.documentType === 'PAYROLL') {
      const pd = await tx.payrollDetail.findUnique({
        where: { documentId: id },
        select: { entityScope: true },
      });
      if (pd?.entityScope === 'FINANCE') periodCompanyCode = 'FINANCE';
    }
    const companyForPeriod = await tx.companyInfo.findFirst({
      where: { companyCode: periodCompanyCode, deletedAt: null },
      select: { id: true },
    });
    if (!companyForPeriod) {
      throw new NotFoundException(
        `CompanyInfo with companyCode=${periodCompanyCode} not found — seed accounting data first`,
      );
    }
    // documentDate is required on the schema but defend against legacy
    // rows with NULL via fallback to "now" (matches receipts.service +
    // payments.service behavior — neither has a per-row date column on
    // the doc, both pass new Date()).
    const periodDate = doc.documentDate ?? new Date();
    await validatePeriodOpen(tx, periodDate, companyForPeriod.id);

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

    // EXPENSE + CREDIT_NOTE + PAYROLL + VENDOR_SETTLEMENT + REPAIR_SERVICE +
    // PETTY_CASH_REIMBURSEMENT supported. Petty cash was dispatched to
    // PettyCashTemplate below but missing from this list, so POST /:id/post
    // answered "type PETTY_CASH_REIMBURSEMENT not supported" for every petty-cash
    // document (found by the DOC-03 integration scenario, #1562).
    if (
      !['EXPENSE', 'CREDIT_NOTE', 'PAYROLL', 'VENDOR_SETTLEMENT', 'REPAIR_SERVICE', 'PETTY_CASH_REIMBURSEMENT'].includes(
        doc.documentType,
      )
    ) {
      throw new BadRequestException(`type ${doc.documentType} not supported`);
    }

    // Fix #C12 — WHT routing invariant. When the doc has WHT > 0, doc.whtFormType
    // MUST be non-null (and a recognised form). Previously the JE template silently
    // defaulted to PND3 → routed to 21-3102, misfiling juristic-vendor WHT under
    // ภ.ง.ด.3 instead of ภ.ง.ด.53 (government compliance bug).
    //
    // C12-symmetry: mirror the guard across all 4 doc types so any
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
    if (doc.documentType === 'PETTY_CASH_REIMBURSEMENT') {
      return this.pettyCashTemplate.execute(id, tx);
    }
    if (doc.documentType === 'REPAIR_SERVICE') {
      // SHOP repair expense → post on the SHOP chart (Cr S21-1103 accrual / S-cash same-day),
      // NOT the generic accrual template which hardcodes the FINANCE Cr 21-1104.
      if (doc.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({
          where: { id: doc.journalEntryId },
          select: { entryNumber: true },
        });
        return { entryNo: existing?.entryNumber ?? doc.journalEntryId, journalEntryId: doc.journalEntryId };
      }
      const full = await tx.expenseDocument.findUniqueOrThrow({
        where: { id },
        include: {
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
          branch: { select: { name: true, shopCashAccountCode: true } },
        },
      });
      const lines = full.expenseDetail?.lines ?? [];
      if (lines.length !== 1) {
        throw new BadRequestException(
          `REPAIR_SERVICE expense doc ${id} must have exactly one line (got ${lines.length})`,
        );
      }
      const line = lines[0];
      const isCash = !!doc.paymentMethod && !!doc.depositAccountCode;
      const result = await this.shopExpenseTemplate.execute(
        {
          idempotencyKey: `shop-expense:${id}`,
          expenseId: id,
          expenseAccountCode: line.category,
          amount: new Prisma.Decimal(line.amountBeforeVat.toString()),
          mode: isCash ? 'CASH' : 'ACCRUAL',
          cashAccountCode: isCash
            ? (doc.depositAccountCode ?? full.branch?.shopCashAccountCode ?? undefined)
            : undefined,
          branchName: full.branch?.name,
        },
        tx,
      );
      await tx.expenseDocument.update({
        where: { id },
        data: { status: isCash ? 'POSTED' : 'ACCRUAL', journalEntryId: result.journalEntryId },
      });
      return result;
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
  }

  // ─── Approve (PENDING_APPROVAL → APPROVED → optionally POSTED) ────────
  // D1.2.1.6 — second leg of the Approval Workflow. The DRAFT →
  // PENDING_APPROVAL gate is wired in D1.2.1.1 (approval_enabled flag).
  //
  // Behaviour:
  //  - Loads the doc under the same `post:` advisory lock so a concurrent
  //    approve+post cannot double-post a JE.
  //  - Asserts the source status is PENDING_APPROVAL.
  //  - Flips status → APPROVED.
  //  - Reads SystemConfig `auto_post_on_approve` (default true). When true,
  //    chains to post() in the same transaction so APPROVED never persists
  //    visibly. When false, returns the APPROVED doc and OWNER posts later
  //    by calling /expenses/:id/post (which now also accepts APPROVED via
  //    StatusTransitionService.assertCanPost).
  //
  // userId is captured for audit logs (APPROVED + AUTO_POSTED actions written
  // inside the same tx). Signature parity with post() / voidDocument().
  async approve(id: string, userId: string, _userRole?: string) {
    return this.prisma.$transaction(async (tx) => {
      // Re-use the `post:` lock key — approve always either becomes the JE
      // post (auto path) or precedes a future post(), so serializing on the
      // same lock is correct.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `post:${id}`);

      // Resolve current per-user permission, including active OWNER identity.
      const { user: actor } = await assertAccountingPermission(tx, userId, 'EXPENSE_APPROVE');

      const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
      assertAccountingBranch(actor, doc.branchId);
      // maker≠checker — เฉพาะระดับผู้จัดการขึ้นไปที่อนุมัติใบที่ตัวเองสร้างได้
      // (คำตัดสินเจ้าของ 2026-09-11) ด่านนี้ต้องอยู่ฝั่งเซิร์ฟเวอร์ด้วย ไม่ใช่แค่ซ่อนปุ่ม
      if (!canApproveAccountingDoc({
        role: actor.role,
        actorUserId: actor.id,
        documentCreatedById: doc.createdById,
      })) {
        throw new ForbiddenException(SELF_APPROVAL_DENIED_MESSAGE);
      }
      this.transition.assertCanApprove({ from: doc.status });

      // Stamp APPROVED first so the auto-post branch starts from a clean
      // APPROVED row (assertCanPost permits APPROVED). When auto-post is off
      // the APPROVED state persists and downstream post() will pick it up.
      await tx.expenseDocument.update({
        where: { id },
        data: { status: 'APPROVED' as DocumentStatus, approvedById: userId },
      });

      // D1.2.1.6 — APPROVED audit log (always written, regardless of auto-post).
      await tx.auditLog.create({
        data: {
          action: 'APPROVED',
          entity: 'expense_document',
          entityId: id,
          userId,
          oldValue: { status: 'PENDING_APPROVAL' },
          newValue: { status: 'APPROVED' },
        },
      });

      const autoPost = await this.readBoolFlag(tx, 'auto_post_on_approve', true);
      if (!autoPost) {
        return tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      }

      // Auto-post chain — delegated to executePostBody() shared helper.
      // Skips the lock (already held) and the from-DRAFT assertCanPost (we
      // just set APPROVED, which assertCanPost permits per D1.2.1.6). All
      // integrity guards (period open, attachment threshold, WHT routing,
      // V15 ACCRUAL-no-WHT, type allow-list) run via the helper so any
      // future change to those guards lands in both paths automatically.
      const result = await this.executePostBody(doc, tx);

      // D1.2.1.6 — AUTO_POSTED audit log (only when auto_post_on_approve=true
      // and the auto-post chain completed without throwing).
      await tx.auditLog.create({
        data: {
          action: 'AUTO_POSTED',
          entity: 'expense_document',
          entityId: id,
          userId,
          newValue: { status: 'POSTED', autoPostedFromApproval: true },
        },
      });

      return result;
    });
  }

  async voidDocument(
    id: string,
    userId: string,
    dto: VoidExpenseDocumentDto = {},
    _userRole?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { user: actor } = await assertAccountingPermission(tx, userId, 'EXPENSE_CANCEL');
      // Per-doc advisory lock — serializes concurrent voids on the same id so
      // two callers cannot both pass assertCanVoid and double-post a reversal JE.
      // (PG REPEATABLE READ does not prevent this write skew on its own.)
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `post:${id}`);

      const doc = await tx.expenseDocument.findUniqueOrThrow({
        where: { id },
        include: { settlement: { include: { settlementLines: true } } },
      });
      if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
      assertAccountingBranch(actor, doc.branchId);

      // D1.2.7.4 — `reverse_block_cascaded` (default true). OWNER may disable
      // via SystemConfig to allow voiding upstream docs even when downstream CN/SE
      // exist. Default-on preserves the strict safety from C3.4. If owner
      // disables, downstream consumers will become orphaned — UI must surface
      // this risk separately (out of scope here).
      const cascadeBlockEnabled = await this.readBoolFlag(tx, 'reverse_block_cascaded', true);

      const pendingCn = await tx.expenseDocument.count({
        where: {
          documentType: 'CREDIT_NOTE',
          status: { not: 'VOIDED' },
          deletedAt: null,
          creditNote: { originalDocumentId: id },
        },
      });
      if (cascadeBlockEnabled && pendingCn > 0) {
        throw new BadRequestException('มีใบลดหนี้ที่ยังไม่ถูกยกเลิก ไม่สามารถยกเลิกเอกสารต้นฉบับได้');
      }

      // C3.4 — Cascade check: also block void when an active SETTLEMENT
      // clears this doc. (Settlement-on-void of the SE itself separately
      // reverts cleared docs back to ACCRUAL — that's the SE-being-voided
      // path, not this one.) Gated by the same `reverse_block_cascaded` flag.
      const pendingSe = await tx.expenseDocument.count({
        where: {
          documentType: 'VENDOR_SETTLEMENT',
          status: { not: 'VOIDED' },
          deletedAt: null,
          settlement: { settlementLines: { some: { clearedDocumentId: id } } },
        },
      });
      if (cascadeBlockEnabled && pendingSe > 0) {
        throw new BadRequestException(
          'มีใบจ่ายเจ้าหนี้ (SE) ที่ยังไม่ถูกยกเลิกอ้างถึงเอกสารนี้อยู่ — ' +
            'กรุณายกเลิก SE ก่อน',
        );
      }

      // D1.2.7.1 — `reverse_reason_required` (default true). When enabled,
      // server enforces that `dto.reasonCode` is present + non-empty. UI
      // already enforces via canSubmit, but the server gate prevents a
      // bypass (e.g. direct curl without going through ReverseDialog).
      const reasonRequired = await this.readBoolFlag(tx, 'reverse_reason_required', true);
      if (reasonRequired && !dto.reasonCode?.trim()) {
        throw new BadRequestException('กรุณาระบุเหตุผลในการยกเลิกเอกสาร');
      }

      // D1.2.7.2 — `reverse_reasons` SystemConfig (default = 6 canonical
      // codes). Validate dto.reasonCode against the configured whitelist
      // when present. OWNER can extend/override the list via SettingsService.
      if (dto.reasonCode?.trim()) {
        const reasons = await getReverseReasons(tx);
        const allowed = new Set(reasons.map((r) => r.code));
        if (!allowed.has(dto.reasonCode)) {
          throw new BadRequestException(
            `เหตุผล "${dto.reasonCode}" ไม่อยู่ในรายการที่ตั้งค่าไว้`,
          );
        }
      }

      // D1.2.6.4 — `payment_date_allow_future` (default true). When OWNER
      // disables, reject future-dated reverseDate. UI also shows warning.
      if (dto.reverseDate) {
        const allowFuture = await this.readBoolFlag(tx, 'payment_date_allow_future', true);
        if (!allowFuture) {
          const dateUtc = new Date(dto.reverseDate);
          const todayBkk = new Date();
          // Strip time so the check is calendar-day comparison.
          if (dateUtc.getTime() > todayBkk.getTime()) {
            throw new BadRequestException(
              'ไม่อนุญาตให้ระบุวันที่ในอนาคต — กรุณาเลือกวันที่ไม่เกินวันนี้',
            );
          }
        }
      }

      this.transition.assertCanVoid({ from: doc.status });

      // Fix #C9 (Round 2 — moved from journal-auto.service.createAndPost):
      // Period-open guard at the module boundary. C3.1 — when caller passes
      // `reverseDate`, the reversal JE postedAt uses it (still V19-gated); else
      // the legacy behavior (today BKK noon).
      const reverseAt = dto.reverseDate
        ? bkkBusinessDate(new Date(dto.reverseDate))
        : bkkBusinessDate(new Date());
      // 2026-08-06 (review fix) — guard the period of the company the reversal
      // JE will actually post under. FINANCE-scope payroll (the first doc type
      // whose JE lives under the FINANCE company) must check FINANCE's
      // AccountingPeriod, not SHOP's — otherwise a void could slip a reversal
      // into a closed FINANCE month, bypassing the OWNER-only reopen flow.
      let voidPeriodCompanyCode: 'SHOP' | 'FINANCE' = 'SHOP';
      if (doc.documentType === 'PAYROLL') {
        const pd = await tx.payrollDetail.findUnique({
          where: { documentId: id },
          select: { entityScope: true },
        });
        if (pd?.entityScope === 'FINANCE') voidPeriodCompanyCode = 'FINANCE';
      }
      const companyForVoidPeriod = await tx.companyInfo.findFirst({
        where: { companyCode: voidPeriodCompanyCode, deletedAt: null },
        select: { id: true },
      });
      if (!companyForVoidPeriod) {
        throw new NotFoundException(
          `CompanyInfo with companyCode=${voidPeriodCompanyCode} not found — seed accounting data first`,
        );
      }
      await validatePeriodOpen(tx, reverseAt, companyForVoidPeriod.id);

      // Post reversal JE (flipped Dr/Cr) if doc had one. The original JE stays
      // intact; the reversal lives as a separate POSTED entry tagged via metadata.
      // Reversal postedAt is BKK noon "today" — keeps the entry inside the
      // intended Thai accounting day regardless of UTC server clock.
      let reverseJournalEntryId: string | null = null;
      if (doc.journalEntryId) {
        const original = await tx.journalEntry.findUniqueOrThrow({
          where: { id: doc.journalEntryId },
          include: { lines: true },
        });
        // W6 fix — fall back to SHOP company id when legacy JE rows lack
        // companyId (pre-A.1b migration). Without this, voiding an old EX
        // throws "companyId required" from journal-auto.service. SHOP is the
        // canonical home for expense-side flows per accounting.md.
        let companyId = original.companyId;
        if (!companyId) {
          const shop = await tx.companyInfo.findFirst({
            where: { companyCode: 'SHOP', deletedAt: null },
            select: { id: true },
          });
          if (!shop) {
            // W6 (Round 2) — replace bare Error with NestJS exception so the
            // response is a clean 404 instead of a 500 with stack trace. Same
            // wording shape as the post()/voidDocument() period-guard SHOP
            // fallback and the FINANCE fallback in resolveFinanceCompanyId.
            throw new NotFoundException(
              'CompanyInfo with companyCode=SHOP not found — seed accounting data first',
            );
          }
          companyId = shop.id;
        }
        const reverseEntry = await this.journal.createAndPost(
          {
            description: `กลับรายการ ${doc.number}`,
            // Keep one reversal per document without colliding with the
            // original AUTO reference. Metadata retains the source document.
            reference: `${doc.id}:reversal`,
            metadata: {
              tag: 'EXPENSE_VOID_REVERSAL',
              documentId: doc.id,
              documentNumber: doc.number,
              documentType: doc.documentType,
              originalJournalEntryId: original.id,
              flow: `expense-${doc.documentType.toLowerCase()}-void`,
              // C3 — reason metadata embedded so JE-side audits can grep
              // by reasonCode without joining audit_logs.
              reverseReasonCode: dto.reasonCode ?? null,
              reverseReasonDetail: dto.reasonDetail ?? null,
            },
            postedAt: reverseAt,
            companyId,
            lines: original.lines.map((l) => ({
              accountCode: l.accountCode,
              dr: new Prisma.Decimal(l.credit.toString()),
              cr: new Prisma.Decimal(l.debit.toString()),
              description: l.description ? `[กลับรายการ] ${l.description}` : '[กลับรายการ]',
            })),
          },
          tx,
        );
        reverseJournalEntryId = reverseEntry.id;
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

      // C3.3 — Audit trail with reason + reverse JE pointer. Stuffed into
      // `newValue` JSON rather than adding columns (AuditLog has a Merkle hash
      // chain — adding columns would break the verification path on existing rows).
      await tx.auditLog.create({
        data: {
          action: 'EXPENSE_VOIDED',
          entity: 'expense_document',
          entityId: id,
          userId,
          oldValue: { status: doc.status, journalEntryId: doc.journalEntryId },
          newValue: {
            status: 'VOIDED',
            reverseJournalEntryId,
            reverseDate: reverseAt.toISOString(),
            reasonCode: dto.reasonCode ?? null,
            reasonDetail: dto.reasonDetail ?? null,
            // Structured reverse reason — read by the shared timeline's
            // mapAuditEvents (parity with other-income / asset modules).
            reverseReasonLabel: dto.reasonLabel ?? null,
            reverseNote: dto.note ?? null,
            documentNumber: doc.number,
            documentType: doc.documentType,
          },
        },
      });

      return tx.expenseDocument.findUniqueOrThrow({ where: { id } });
    });
  }

  // ─── D1.* — Service-side SystemConfig flag readers ─────────────────────
  // Delegates to shared `readBoolFlag` in utils/config.util
  // so every service uses identical parsing + defensive try/catch semantics.
  // Kept as private wrappers for ergonomic (this.readBoolFlag) call sites.
  // Spec-defined defaults flow through `fallback` and preserve first-boot
  // behaviour when the SystemConfig row is missing.
  private async readBoolFlag(
    tx: Prisma.TransactionClient | PrismaService,
    key: string,
    fallback: boolean,
  ): Promise<boolean> {
    return readBoolFlag(tx, key, fallback);
  }

  /**
   * D1.2.1.2 — Numeric SystemConfig reader. Returns the stored Decimal as a
   * Prisma.Decimal, clamped to ≥ 0 (negatives become 0). On missing or
   * unparseable values returns the fallback. Used by the approval-threshold
   * gate where negatives would yield bizarre "every doc requires approval"
   * behaviour.
   *
   * Intentionally NOT consolidated onto config.util.readNumberFlag — that returns
   * a plain number with no clamp; this returns Prisma.Decimal clamped to ≥ 0.
   * Do not dedup without preserving the Decimal return + clamp.
   */
  private async readNumberFlag(
    tx: Prisma.TransactionClient | PrismaService,
    key: string,
    fallback: number,
  ): Promise<Prisma.Decimal> {
    try {
      const row = await tx.systemConfig.findFirst({
        where: { key, deletedAt: null },
        select: { value: true },
      });
      const raw = row?.value;
      if (!raw) return new Prisma.Decimal(fallback);
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return new Prisma.Decimal(fallback);
      const clamped = parsed < 0 ? 0 : parsed;
      return new Prisma.Decimal(clamped);
    } catch {
      return new Prisma.Decimal(fallback);
    }
  }
}
