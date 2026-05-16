import { Injectable, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { createHash } from 'crypto';
import * as Sentry from '@sentry/node';
import { StructuredLoggerService } from '../../common/logger';
import { Prisma, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { ReceiptsService } from '../receipts/receipts.service';
import { AuditService } from '../audit/audit.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { PaymentReceipt2BTemplate } from '../journal/cpa-templates/payment-receipt-2b.template';
import { AccountRoleService } from '../journal/account-role.service';
import { ProductsService } from '../products/products.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { roundBaht } from '../../utils/installment.util';
import { BUSINESS_RULES } from '../../utils/config.util';
import { d, dAdd, dSub, dMul, dRound, dGte } from '../../utils/decimal.util';
import { LineOaService } from '../line-oa/line-oa.service';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { formatDateShort } from '../../utils/thai-date.util';
import { MdmAutoService } from '../mdm/mdm-auto.service';
import { PromiseService } from '../overdue/promise.service';
import { MdmLockService } from '../overdue/mdm-lock.service';
import { PaymentCase } from './dto/payment.dto';
import { CASH_ACCOUNT_CODES, type CashAccountCode } from './dto/csv-import.dto';
import { BadDebtService } from '../accounting/bad-debt.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly structuredLogger = new StructuredLoggerService(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private receiptsService: ReceiptsService,
    private auditService: AuditService,
    private journalAutoService: JournalAutoService,
    private paymentReceipt2BTemplate: PaymentReceipt2BTemplate,
    private productsService: ProductsService,
    private lineOaService: LineOaService,
    private flexTemplates: FlexTemplatesService,
    private quickReplyService: QuickReplyService,
    // BadDebtService is REQUIRED — ECL stage reverse on payment is a
    // regulatory requirement (NPAEs Ch.13). Failure to load the dependency
    // must break boot, not silently skip the reverse. Kept above the
    // @Optional() params per TS rule (required cannot follow optional).
    private badDebtService: BadDebtService,
    private roles: AccountRoleService,
    @Optional() private mdmAuto?: MdmAutoService,
    @Optional() @Inject(forwardRef(() => PromiseService)) private promiseService?: PromiseService,
    @Optional() private mdmLockService?: MdmLockService,
  ) {}

  /**
   * T15: Resolve the cash/bank account code for a payment.
   * Priority: user.defaultCashAccountCode → system default '11-1101'.
   */
  private async resolveUserDefaultCashAccount(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { defaultCashAccountCode: true },
    });
    return user?.defaultCashAccountCode ?? '11-1101';
  }

  /**
   * F-3-027 part 2/3: Resolve FINANCE companyId for HP installment journal entries.
   * Payments on installment contracts post to FINANCE-side accounts (HP Receivable,
   * Interest Income, VAT Output) — must be passed explicitly to JournalAutoService
   * instead of relying on the non-deterministic resolveCompanyId fallback.
   * Hoisted out of the per-installment loop so autoAllocate / applyCreditBalance
   * resolve it once per call rather than once per installment.
   */
  private async resolveFinanceCompanyId(): Promise<string> {
    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!financeCompany) {
      throw new InternalServerErrorException('FINANCE company not configured');
    }
    return financeCompany.id;
  }

  /**
   * Phase A.1b: Resolve SHOP companyId for the SHOP-side commission JE leg.
   * Returns null when SHOP is not configured — JournalAutoService will skip
   * the commission entry rather than fail the payment.
   */
  private async resolveShopCompanyId(): Promise<string | null> {
    const shop = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return shop?.id ?? null;
  }

  /** Enforce branch-level access: SALES/BRANCH_MANAGER can only operate on their own branch */
  async validateBranchAccess(
    contractId: string,
    user: { role: string; branchId: string | null },
  ) {
    if (hasCrossBranchAccess(user)) return;

    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { branchId: true, deletedAt: true },
    });
    if (contract && !contract.deletedAt && user.branchId && contract.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถบันทึกชำระเงินข้ามสาขาได้');
    }
  }

  /**
   * W1 fix: enforce branch-level access when the caller only knows the
   * paymentId (waive-late-fee + partial-QR endpoints). Looks up the
   * payment's contractId and delegates to validateBranchAccess.
   *
   * Routes guarded by class-level BranchGuard pass only when the request
   * carries `branchId` — these payment-keyed routes don't, so they were
   * silently bypassing the cross-branch check. This helper closes the gap.
   */
  async validateBranchAccessByPayment(
    paymentId: string,
    user: { role: string; branchId: string | null },
  ) {
    if (hasCrossBranchAccess(user)) return;
    // Round 2 W1 fix: collapse the previous 2 queries (payment.findUnique →
    // contract.findUnique) into a single join. Saves a roundtrip on every
    // waive-late-fee + partial-QR call. Inline the branchId check here so
    // we don't re-fetch the contract via validateBranchAccess().
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        deletedAt: true,
        contract: { select: { branchId: true, deletedAt: true } },
      },
    });
    if (!payment || payment.deletedAt) {
      throw new NotFoundException('ไม่พบรายการชำระ');
    }
    const contract = payment.contract;
    if (
      contract &&
      !contract.deletedAt &&
      user.branchId &&
      contract.branchId !== user.branchId
    ) {
      throw new ForbiddenException('ไม่สามารถบันทึกชำระเงินข้ามสาขาได้');
    }
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
  ) {
    if (!amount || amount <= 0) {
      throw new BadRequestException('จำนวนเงินต้องมากกว่า 0');
    }

    // บังคับ upload หลักฐานการชำระเงิน (สลิป/เลขอ้างอิง)
    if (!evidenceUrl && !transactionRef) {
      throw new BadRequestException('ต้อง upload หลักฐานการชำระเงิน (สลิปโอนเงิน) หรือระบุเลขอ้างอิงธุรกรรม');
    }

    // CR-7: Validate payment date is not in a closed accounting period
    await validatePeriodOpen(this.prisma, new Date());

    // T16: Tolerance approver role validation.
    // If toleranceApproverId is supplied, verify the named user has an approved role.
    // This is validated early (before the serializable tx) to fail fast without
    // holding a DB lock on a rejection.
    if (toleranceApproverId) {
      const approver = await this.prisma.user.findUnique({
        where: { id: toleranceApproverId },
        select: { id: true, role: true, deletedAt: true },
      });
      if (!approver || approver.deletedAt) {
        throw new BadRequestException('ไม่พบผู้อนุมัติที่ระบุ');
      }
      const allowedRoles = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER'];
      if (!allowedRoles.includes(approver.role)) {
        throw new ForbiddenException('ผู้อนุมัติต้องมีบทบาท OWNER, FINANCE_MANAGER, ACCOUNTANT หรือ BRANCH_MANAGER');
      }
    }

    // T15: Resolve deposit account — caller-provided > user default > system default 11-1101
    const resolvedDepositAccountCode = depositAccountCode ?? (await this.resolveUserDefaultCashAccount(recordedById));

    // F-3-027 part 2/3 + Phase A.1b: resolve FINANCE + SHOP companyIds BEFORE
    // the transaction so both can be passed explicitly to the payment JE.
    // FINANCE = HP receivable / interest / VAT side; SHOP = commission income side.
    const financeCompanyId = await this.resolveFinanceCompanyId();
    const shopCompanyId = await this.resolveShopCompanyId();

    // Capture dueDate for loyalty points check (on-time = paidDate <= dueDate)
    let capturedDueDate: Date | null = null;
    let capturedCustomerId: string | null = null;

    // Use serializable transaction to prevent concurrent duplicate payments
    const updated = await this.prisma.$transaction(async (tx) => {
      // Idempotency: reject duplicate transactionRef INSIDE transaction
      // to prevent race condition where two concurrent requests both pass the check.
      // R-012: Use exact ref: tag match to avoid false positives from substring matching.
      // We search for the exact tag "ref:<value>" and verify it matches fully,
      // preventing e.g. "ref:ABC" from matching "ref:ABC123".
      if (transactionRef) {
        const candidates = await tx.payment.findMany({
          where: {
            contractId,
            deletedAt: null,
            notes: { contains: `ref:${transactionRef}` },
            status: { in: ['PAID', 'PARTIALLY_PAID'] },
          },
          select: { id: true, notes: true },
        });
        // Verify exact match: the ref tag must be followed by end-of-string, ' |', or whitespace
        const exactRefPattern = new RegExp(`ref:${transactionRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*\\||\\s*$)`);
        const existing = candidates.find(c => c.notes && exactRefPattern.test(c.notes));
        if (existing) {
          throw new BadRequestException(`ธุรกรรมนี้ถูกบันทึกแล้ว (อ้างอิง: ${transactionRef})`);
        }
      }

      const contract = await tx.contract.findUnique({ where: { id: contractId } });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
      if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
        throw new BadRequestException('ไม่สามารถชำระเงินได้ สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
      }
      capturedCustomerId = contract.customerId;

      const payment = await tx.payment.findFirst({
        where: { contractId, installmentNo, deletedAt: null },
      });
      if (!payment) throw new NotFoundException('ไม่พบงวดที่ต้องการ');
      if (payment.status === 'PAID') throw new BadRequestException('งวดนี้ชำระแล้ว');
      capturedDueDate = payment.dueDate;

      // Auto-cancel any active partial-payment QR for this Payment so the
      // customer can't double-pay through a stale QR they were sent earlier.
      // (Webhook path marks PAID first then calls recordPayment, so the
      // updateMany here is a no-op for that case — only cashier-initiated
      // CASH/TRANSFER recording triggers the cancel.)
      await tx.partialPaymentLink.updateMany({
        where: { paymentId: payment.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      // Real-time late fee: recalculate at payment time (cron may not have run yet)
      let lateFee = d(payment.lateFee);
      if (!payment.lateFeeWaived && payment.dueDate < new Date()) {
        const daysOverdue = Math.floor((Date.now() - payment.dueDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOverdue > 0) {
          const config = await tx.systemConfig.findUnique({ where: { key: 'late_fee_per_day' } });
          const capConfig = await tx.systemConfig.findUnique({ where: { key: 'late_fee_cap' } });
          const feePerDay = config ? d(config.value) : d(50);
          const cap = capConfig ? d(capConfig.value) : d(1500);
          const pctCap = dMul(payment.amountDue, BUSINESS_RULES.LATE_FEE_CAP_PCT);
          const calculatedFee = dRound(Prisma.Decimal.min(dMul(feePerDay, daysOverdue), cap, pctCap));
          if (calculatedFee.gt(lateFee)) {
            lateFee = calculatedFee;
            await tx.payment.update({ where: { id: payment.id }, data: { lateFee } });
          }
        }
      }

      const amountDue = dRound(dAdd(payment.amountDue, lateFee));
      const prevPaid = dRound(d(payment.amountPaid));
      const remaining = dRound(dSub(amountDue, prevPaid));

      // Advance balance split logic (Task 4):
      // - OVERPAY_ADVANCE: overage > 1฿ parked as advance (Cr 21-1103)
      // - NORMAL/others: auto-consume existing advance to cover shortfall
      const overage = d(amount).minus(remaining);
      let advanceCredit = d(0);
      let advanceConsume = d(0);
      const beforeAdvance = d(contract.advanceBalance ?? 0);
      let isPartialClear = false;

      if (overage.gt(d('1.00'))) {
        // Overpay > tolerance — must explicitly opt into advance posting
        if (paymentCase !== 'OVERPAY_ADVANCE') {
          throw new BadRequestException(
            `จำนวนเงินเกินยอดค้างชำระ (ยอดค้าง ${remaining.toNumber().toLocaleString()} บาท, ชำระ ${amount.toLocaleString()} บาท) — ต้องเลือก case 'OVERPAY_ADVANCE' เพื่อบันทึกส่วนเกินเป็นเงินรับล่วงหน้า`,
          );
        }
        advanceCredit = overage;
      } else if (
        d(amount).lt(remaining) &&
        beforeAdvance.gt(0) &&
        (paymentCase === undefined || paymentCase === 'NORMAL')
      ) {
        // Auto-consume FIFO ONLY for default/NORMAL case. PARTIAL/RESCHEDULE/EARLY_PAYOFF
        // are explicit flows where the caller controls allocation directly.
        const gap = remaining.minus(d(amount));
        advanceConsume = Prisma.Decimal.min(beforeAdvance, gap);
      }

      // NEW: shortage > 1฿ requires explicit case='PARTIAL'.
      // Compute shortage AFTER advanceConsume (advance covers part of the gap).
      const shortage = remaining.minus(d(amount)).minus(advanceConsume);
      if (shortage.gt(d('1.00'))) {
        if (paymentCase !== 'PARTIAL') {
          throw new BadRequestException(
            `จำนวนเงินน้อยกว่ายอดที่ต้องชำระ (ยอดที่ต้องชำระ ${remaining.toNumber().toLocaleString()} บาท, ชำระ ${amount.toLocaleString()} บาท) — เลือก case 'PARTIAL' เพื่อบันทึกเป็นจ่ายบางส่วน`,
          );
        }
        isPartialClear = true;
      }

      // For OVERPAY_ADVANCE: amountPaid = installmentTotal (full clear via cash + advance posting).
      // Otherwise: amountPaid = cash + consumed advance (may or may not fully clear).
      const recordedAmountPaid =
        paymentCase === 'OVERPAY_ADVANCE' ? remaining : dAdd(prevPaid, amount).plus(advanceConsume);

      const isPaidInFull =
        paymentCase === 'OVERPAY_ADVANCE' ? true : dGte(recordedAmountPaid, amountDue);

      // Append transactionRef to notes for idempotency tracking
      const updatedNotes = transactionRef
        ? [notes, `ref:${transactionRef}`].filter(Boolean).join(' | ')
        : (notes || payment.notes);

      const result = await tx.payment.update({
        where: { id: payment.id },
        data: {
          amountPaid: recordedAmountPaid,
          paidDate: isPaidInFull ? new Date() : null,
          paymentMethod: paymentMethod as PaymentMethod,
          status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
          recordedById,
          evidenceUrl: evidenceUrl || payment.evidenceUrl,
          notes: updatedNotes,
          depositAccountCode: resolvedDepositAccountCode,
        },
      });

      // Update Contract.advanceBalance atomically with payment (Task 4.5)
      const advanceDelta = advanceCredit.minus(advanceConsume);
      if (!advanceDelta.eq(0)) {
        await tx.contract.update({
          where: { id: contractId },
          data: { advanceBalance: { increment: advanceDelta } },
        });
        // Audit advance balance changes for forensics
        await tx.auditLog.create({
          data: {
            action: 'OVERPAY_ADVANCE_RECORDED',
            entity: 'contract',
            entityId: contractId,
            userId: recordedById,
            newValue: {
              paymentId: result.id,
              installmentNo,
              advanceCredit: advanceCredit.toString(),
              advanceConsume: advanceConsume.toString(),
              delta: advanceDelta.toString(),
              beforeBalance: beforeAdvance.toString(),
              afterBalance: beforeAdvance.plus(advanceDelta).toString(),
            },
          },
        });
      }

      // Check if all payments are completed → update contract status
      if (isPaidInFull) {
        await this.checkContractCompletion(contractId, tx);
      }

      // Phase A.4b: replaced createPaymentJournal (old stub) with PaymentReceipt2BTemplate.
      // Template is called on full payment OR partial payment (isPartialClear).
      // It runs inside the same $transaction so a JE failure rolls back the
      // Payment.update — no orphan ledger entries.
      if (isPaidInFull || isPartialClear) {
        const instSched = await tx.installmentSchedule.findUnique({
          where: {
            contractId_installmentNo: {
              contractId: contract.id,
              installmentNo: result.installmentNo,
            },
          },
          select: { id: true },
        });
        if (instSched) {
          // C1 fix: forward computed lateFee to the 2B template so it emits the
          // Cr 42-1103 income leg AND the tolerance check correctly accounts
          // for "amount = installmentTotal + lateFee". Without this, the
          // template would either reject the payment (delta > 1฿ tolerance)
          // or silently drop the 42-1103 income — both were prod bugs.
          await this.paymentReceipt2BTemplate.execute({
            installmentScheduleId: instSched.id,
            amountReceived: new Prisma.Decimal(amount.toString()),
            depositAccountCode: resolvedDepositAccountCode,
            toleranceApproverId: toleranceApproverId,
            existingPaymentId: result.id,
            advanceCredit: advanceCredit.gt(0) ? advanceCredit : undefined,
            advanceConsume: advanceConsume.gt(0) ? advanceConsume : undefined,
            partialClear: isPartialClear ? true : undefined,
            lateFee: lateFee.gt(0) ? lateFee : undefined,
          });

          // CPA Policy A §3.6 — ECL stage reverse on payment.
          // After the receipt JE posts, recompute aging. If the bucket dropped
          // (e.g. B2 → B1) the persisted provision is now overstated; release
          // the over-provision back to P&L atomically inside the same tx so a
          // reverse-JE failure rolls back the receipt.
          try {
            await this.badDebtService.reverseStageOnPayment(contract.id, tx);
          } catch (err) {
            Sentry.captureException(err, {
              extra: { contractId: contract.id, installmentNo: result.installmentNo, paymentId: result.id },
            });
            throw err;
          }
        } else {
          this.logger.warn(
            `PaymentReceipt2B skipped — no InstallmentSchedule found for contractId=${contract.id} installmentNo=${result.installmentNo}. TODO: verify schedule was generated.`,
          );
        }
      }

      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // Structured log for financial audit / observability
    this.structuredLogger.log('payment.recorded', {
      paymentId: updated.id,
      contractId,
      installmentNo,
      amount,
      totalPaid: d(updated.amountPaid).toNumber(),
      status: updated.status,
      paymentMethod,
      transactionRef: transactionRef ?? null,
      recordedById,
    });

    // Financial audit trail
    await this.auditService.logPaymentEvent({
      userId: recordedById,
      contractId,
      paymentId: updated.id,
      action: updated.status === 'PAID' ? 'PAYMENT_RECORDED' : 'PAYMENT_PARTIAL',
      amount,
      installmentNo,
      details: { paymentMethod, transactionRef, totalPaid: d(updated.amountPaid).toNumber() },
    });

    // T16: Write TOLERANCE_APPROVED audit log when a tolerance approver was named.
    // Uses the generic log() path so the hash-chain is preserved.
    // The approver is the userId of the log row (who authorised the rounding),
    // and requestedBy is embedded in newValue for full traceability.
    if (toleranceApproverId) {
      const amountDueForLog = d(updated.amountDue ?? 0);
      const amountReceivedD = d(amount);
      const diffD = amountReceivedD.sub(amountDueForLog).abs();
      await this.auditService.log({
        userId: toleranceApproverId,
        action: 'TOLERANCE_APPROVED',
        entity: 'payment',
        entityId: updated.id,
        newValue: {
          diff: diffD.toString(),
          amountReceived: amountReceivedD.toString(),
          installmentTotal: amountDueForLog.toString(),
          requestedBy: recordedById,
          contractId,
          installmentNo,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // I3 note: every effect below this point runs OUTSIDE the serializable
    // payment tx. All are non-financial / idempotent / explicitly logged on
    // failure — they MUST NOT roll back the committed payment. Effects:
    //   - receiptsService.generateReceipt — own tx + sequence lock
    //   - awardLoyaltyPoints — upsert on unique paymentId, errors logged
    //   - sendPaymentSuccessLine — LINE push, errors swallowed via .warn
    //   - mdmAuto.autoUnlockAfterPayment — fire-and-forget Promise
    //   - checkPromiseAfterPayment — own tx, errors → Sentry only
    //
    // Auto-generate e-Receipt for every payment event (TFRS practice:
    // issue a receipt each time money is received, including partial payments).
    // `amount` here is the actual delta paid in this transaction, not cumulative.
    {
      try {
        await this.receiptsService.generateReceipt(
          contractId,
          updated.id,
          'INSTALLMENT',
          amount,
          installmentNo,
          paymentMethod,
          transactionRef || null,
          recordedById,
        );
      } catch (error) {
        // Receipt generation failure should not block payment, but must be logged
        this.logger.error(
          `Failed to generate receipt for payment ${updated.id} (contract: ${contractId}, installment: ${installmentNo})`,
          error instanceof Error ? error.stack : String(error),
        );
      }

      // Award loyalty points for on-time payment (non-blocking)
      if (capturedCustomerId && capturedDueDate) {
        await this.awardLoyaltyPoints(
          capturedCustomerId,
          contractId,
          updated.id,
          amount,
          updated.paidDate,
          capturedDueDate,
        );
      }

      // LINE push notification (non-blocking)
      await this.sendPaymentSuccessLine(contractId, installmentNo, amount, paymentMethod);
    }

    // M3 fix: only run the legacy "all overdue cleared" auto-unlock when there
    // is no active promise-to-pay cycle. When there is an active promise, the
    // checkPromiseAfterPayment hook (below) handles the unlock via its own
    // CYCLE_KEPT path — running both racied two unlock requests per payment.
    if (this.mdmAuto) {
      const hasActivePromise =
        !!this.promiseService && !!(await this.promiseService.findActivePromise(contractId));
      if (!hasActivePromise) {
        this.mdmAuto.autoUnlockAfterPayment(contractId).catch((err) =>
          this.logger.error('MDM auto-unlock failed', err),
        );
      }
    }

    // Promise-to-pay kept-detection — runs AFTER the payment tx commits so
    // MDM/audit failures cannot roll back the payment row.
    this.checkPromiseAfterPayment(contractId).catch((err) => {
      this.logger.error('Promise-kept hook failed (non-blocking)', err);
      Sentry.captureException(err, { tags: { hook: 'checkPromiseAfterPayment', contractId } });
    });

    return updated;
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
    if (!amount || amount <= 0) {
      throw new BadRequestException('จำนวนเงินต้องมากกว่า 0');
    }

    // F-3-027 part 2/3 + Phase A.1b: resolve FINANCE + SHOP companyIds once
    // before the tx so the per-installment JE calls below use them.
    const financeCompanyId = await this.resolveFinanceCompanyId();
    const shopCompanyId = await this.resolveShopCompanyId();

    // W2 fix: resolve the deposit-account code for the recorder ONCE (mirrors
    // recordPayment line ~160). Previously the per-installment Payment.update
    // omitted depositAccountCode, so the downstream JE fell back to '11-1101'
    // (สุทธินีย์) regardless of who actually collected the money.
    const resolvedDepositAccountCode = await this.resolveUserDefaultCashAccount(recordedById);

    // Wrap entire allocation in a serializable transaction to prevent double-payment
    const allocationResult = await this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        include: { payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } } },
      });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
      if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
        throw new BadRequestException('ไม่สามารถชำระเงินได้ สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
      }

      let remaining = d(amount);
      const results: { updated: Awaited<ReturnType<typeof tx.payment.update>>; payAmount: Prisma.Decimal }[] = [];

      // Get unpaid payments in order
      const unpaid = contract.payments.filter((p) => p.status !== 'PAID');
      if (unpaid.length === 0) throw new BadRequestException('ไม่มีงวดค้างชำระ');

      for (const [idx, payment] of unpaid.entries()) {
        if (remaining.lte(0)) break;

        const amountDue = dRound(dSub(dAdd(payment.amountDue, payment.lateFee), payment.amountPaid));
        const payAmount = dRound(Prisma.Decimal.min(remaining, amountDue));
        const totalPaid = dRound(dAdd(payment.amountPaid, payAmount));
        const isPaidInFull = dGte(totalPaid, dRound(dAdd(payment.amountDue, payment.lateFee)));

        // Attach evidenceUrl to the FIRST payment only (represents the transfer slip)
        const isFirstPayment = idx === 0;

        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: totalPaid,
            paidDate: isPaidInFull ? new Date() : null,
            paymentMethod: paymentMethod as PaymentMethod,
            status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
            recordedById,
            notes: notes || payment.notes,
            depositAccountCode: resolvedDepositAccountCode,
            ...(isFirstPayment && evidenceUrl ? { evidenceUrl } : {}),
          },
        });

        // W3 fix: audit-log each per-installment payment created here.
        // Previously only recordPayment emitted PAYMENT_RECORDED — the bulk
        // path skipped audit, so allocated payments showed no audit trail.
        await tx.auditLog.create({
          data: {
            userId: recordedById,
            action: isPaidInFull ? 'PAYMENT_RECORDED' : 'PAYMENT_PARTIAL',
            entity: 'payment',
            entityId: updated.id,
            newValue: {
              contractId,
              installmentNo: updated.installmentNo,
              amount: payAmount.toString(),
              paymentMethod,
              source: 'AUTO_ALLOCATE',
              depositAccountCode: resolvedDepositAccountCode,
            },
          },
        });

        results.push({ updated, payAmount });
        remaining = dSub(remaining, payAmount);

        // Check contract completion after each full payment
        if (isPaidInFull) {
          await this.checkContractCompletion(contractId, tx);

          // Phase A.4b: replaced createPaymentJournal (old stub) with PaymentReceipt2BTemplate.
          // autoAllocate has no depositAccountCode param — use system default.
          const instSchedBulk = await tx.installmentSchedule.findUnique({
            where: {
              contractId_installmentNo: {
                contractId: contract.id,
                installmentNo: updated.installmentNo,
              },
            },
            select: { id: true },
          });
          if (instSchedBulk) {
            await this.paymentReceipt2BTemplate.execute({
              installmentScheduleId: instSchedBulk.id,
              amountReceived: new Prisma.Decimal(updated.amountPaid.toString()),
              // W2 fix: use the resolvedDepositAccountCode that we just
              // wrote on Payment.update — previously this read the field
              // off the in-memory Prisma return value which may not yet
              // reflect the same value (and read '11-1101' fallback).
              depositAccountCode: updated.depositAccountCode ?? resolvedDepositAccountCode,
              existingPaymentId: updated.id,
            });
          } else {
            this.logger.warn(
              `PaymentReceipt2B skipped (bulk) — no InstallmentSchedule for contractId=${contract.id} installmentNo=${updated.installmentNo}`,
            );
          }
        }
      }

      // Auto-generate e-Receipts for every payment event (TFRS practice:
      // issue a receipt each time money is received, including partial payments).
      // Receipt amount = the delta applied to this installment in this transaction,
      // not the cumulative amountPaid.
      for (const { updated: paid, payAmount } of results) {
        if (payAmount.lte(0)) continue;
        try {
          await this.receiptsService.generateReceipt(
            contractId,
            paid.id,
            'INSTALLMENT',
            dRound(payAmount).toNumber(),
            paid.installmentNo,
            paymentMethod,
            null,
            recordedById,
          );
        } catch (error) {
          this.logger.error(
            `Failed to generate receipt for payment ${paid.id} (contract: ${contractId}, installment: ${paid.installmentNo})`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      const overpayment = remaining.gt(0) ? dRound(remaining) : d(0);
      if (overpayment.gt(0)) {
        // Store overpayment as credit balance on the contract
        await tx.contract.update({
          where: { id: contractId },
          data: {
            creditBalance: { increment: overpayment },
          },
        });

        this.logger.warn(
          `Overpayment of ${overpayment.toNumber()} THB credited to contract ${contractId}. ` +
          `Customer paid ${amount} THB, ${d(amount).sub(remaining).toNumber()} THB allocated, ${overpayment.toNumber()} THB stored as credit.`,
        );

        // Phase A.1b: post overpayment JE (Dr Cash / Cr Customer Credit).
        // Reference the last allocated payment so the JE is traceable to the
        // payment event that produced the overpayment. If no installment was
        // allocated (full overpayment — edge case), fall back to contractId.
        const referencePaymentId = results.length > 0
          ? results[results.length - 1].updated.id
          : contractId;
        // Phase A.4b: replaced createCustomerCreditOverpaymentJournal (old stub)
        // with inline createAndPost. JE: Dr Cash (deposit) / Cr 21-5101 Customer Credit Balance.
        // 21-5101 = เงินเกินของลูกค้า (confirmed in finance-chart-of-accounts.csv).
        // W2 fix: use the resolvedDepositAccountCode (caller's actual cash
        // account) instead of the per-row fallback which masked the user's
        // default and silently re-routed every overpayment JE to 11-1101.
        const depositCode = results.length > 0
          ? (results[results.length - 1].updated.depositAccountCode ?? resolvedDepositAccountCode)
          : resolvedDepositAccountCode;
        const zero = new Prisma.Decimal(0);
        await this.journalAutoService.createAndPost(
          {
            description: `เงินเกินชำระ — สัญญา ${contract.contractNumber} บันทึกเครดิต ${overpayment.toFixed(2)} บาท`,
            reference: referencePaymentId,
            metadata: {
              tag: 'overpayment-credit',
              contractId: contract.id,
              paymentId: referencePaymentId,
            },
            lines: [
              {
                accountCode: depositCode,
                dr: overpayment,
                cr: zero,
                description: 'รับเงินเกิน',
              },
              {
                accountCode: '21-5101',
                dr: zero,
                cr: overpayment,
                description: 'เงินเกินของลูกค้า (Customer Credit Balance)',
              },
            ],
          },
          tx,
        );
      }

      return {
        allocatedPayments: results.map((r) => r.updated),
        totalAllocated: dSub(amount, remaining).toNumber(),
        overpayment: overpayment.toNumber(),
        overpaymentMessage: overpayment.gt(0)
          ? `มีเงินเกินจำนวน ${overpayment.toNumber().toLocaleString()} บาท บันทึกเป็นยอดเครดิตในสัญญา`
          : null,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // Promise-to-pay kept-detection — runs AFTER the payment tx commits.
    this.checkPromiseAfterPayment(contractId).catch((err) => {
      this.logger.error('Promise-kept hook failed (non-blocking)', err);
      Sentry.captureException(err, { tags: { hook: 'checkPromiseAfterPayment', contractId } });
    });

    return allocationResult;
  }

  // ─── Get payments for a contract ──────────────────────
  async getContractPayments(contractId: string, page = 1, limit = 50) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
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
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  // ─── Get all pending payments (for payment queue view) ─
  async getPendingPayments(filters: {
    branchId?: string;
    date?: string;
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

    return paginatedResponse(data, total, page, limit);
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

  /** Parse a single CSV line handling quoted fields (e.g., "value with, comma") */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'; // escaped quote
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  // ─── Check if contract is fully paid ──────────────────
  private async checkContractCompletion(
    contractId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db: Prisma.TransactionClient | PrismaService = tx ?? this.prisma;
    const unpaid = await db.payment.count({
      where: { contractId, status: { not: 'PAID' }, deletedAt: null },
    });

    if (unpaid !== 0) return;

    // All installments paid → mark contract as COMPLETED
    const completed = await db.contract.update({
      where: { id: contractId },
      data: { status: 'COMPLETED' },
      select: { productId: true },
    });

    // Recording lifecycle: STANDARD → CLOSED so storage cron / GCS lifecycle
    // can transition recordings to a cheaper tier. Only bump rows still on
    // STANDARD to avoid clobbering LEGAL_HOLD set by an open legal case.
    await db.callLog.updateMany({
      where: {
        contractId,
        recordingStorageTier: 'STANDARD',
        recordingUrl: { not: null },
        deletedAt: null,
      },
      data: { recordingStorageTier: 'CLOSED' },
    });

    // Ownership release: FINANCE → null (customer now owns the device).
    // Uses the same tx so the ownership flip cannot diverge from the
    // COMPLETED status. `tx` is a proper Prisma.TransactionClient when
    // called from recordPayment; when called without tx we fall through
    // to this.prisma which the helper also accepts.
    if (completed?.productId) {
      try {
        await this.productsService.transferOwnership(
          completed.productId,
          null,
          tx,
        );
      } catch (err) {
        this.logger.error(
          `Failed to release product ownership for completed contract ${contractId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  // ─── Apply credit balance to next pending installment ─
  async applyCreditBalance(contractId: string, recordedById: string) {
    // F-3-027 part 2/3 + Phase A.1b: resolve FINANCE + SHOP companyIds once
    // before the tx so the per-installment JE calls below use them.
    const financeCompanyId = await this.resolveFinanceCompanyId();
    const shopCompanyId = await this.resolveShopCompanyId();

    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        include: { payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } } },
      });
      if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

      const credit = d(contract.creditBalance);
      if (credit.lte(0)) {
        throw new BadRequestException('ไม่มียอดเครดิตในสัญญานี้');
      }

      // Find next unpaid installment
      const unpaid = contract.payments.filter((p) => p.status !== 'PAID');
      if (unpaid.length === 0) {
        throw new BadRequestException('ไม่มีงวดค้างชำระ');
      }

      let remaining = credit;
      const results: Awaited<ReturnType<typeof tx.payment.update>>[] = [];

      for (const payment of unpaid) {
        if (remaining.lte(0)) break;

        const amountDue = dRound(dSub(dAdd(payment.amountDue, payment.lateFee), payment.amountPaid));
        const payAmount = dRound(Prisma.Decimal.min(remaining, amountDue));
        const totalPaid = dRound(dAdd(payment.amountPaid, payAmount));
        const isPaidInFull = dGte(totalPaid, dRound(dAdd(payment.amountDue, payment.lateFee)));

        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: totalPaid,
            paidDate: isPaidInFull ? new Date() : null,
            paymentMethod: 'CREDIT_BALANCE',
            status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
            recordedById,
            notes: [payment.notes, `ใช้เครดิต ${payAmount.toNumber().toLocaleString()} บาท`].filter(Boolean).join(' | '),
          },
        });

        // W3 fix: previously applyCreditBalance left no audit trail.
        // Emit CREDIT_APPLIED per installment for forensic visibility.
        await tx.auditLog.create({
          data: {
            userId: recordedById,
            action: 'CREDIT_APPLIED',
            entity: 'payment',
            entityId: updated.id,
            newValue: {
              contractId,
              installmentNo: updated.installmentNo,
              payAmount: payAmount.toString(),
              totalPaidAfter: totalPaid.toString(),
              becamePaidInFull: isPaidInFull,
            },
          },
        });

        results.push(updated);
        remaining = dSub(remaining, payAmount);

        if (isPaidInFull) {
          await this.checkContractCompletion(contractId, tx);

          // Phase A.4b: replaced createCreditAllocationJournal (old stub).
          // Dr 21-5101 Customer Credit / Cr 11-2103 ลูกหนี้ค้างชำระ —
          // clears the customer credit balance against the outstanding receivable.
          // No Dr Cash because the cash was already recorded when the overpayment
          // was originally received (audit finding F-1-004).
          //
          // C4 fix: use `payAmount` (the delta applied in THIS allocation) not
          // `updated.amountPaid` (cumulative). The previous code over-Dr'd
          // 21-5101 by the prior partial-paid portion, driving the customer-
          // credit account to negative when an installment had been partially
          // paid before the credit balance was applied.
          const creditZero = new Prisma.Decimal(0);
          const creditPayAmount = new Prisma.Decimal(payAmount.toString());
          await this.journalAutoService.createAndPost(
            {
              description: `ใช้เครดิตชำระงวด #${updated.installmentNo} — สัญญา ${contract.contractNumber}`,
              reference: updated.id,
              metadata: {
                tag: 'credit-allocation',
                contractId: contract.id,
                paymentId: updated.id,
              },
              lines: [
                {
                  accountCode: '21-5101',
                  dr: creditPayAmount,
                  cr: creditZero,
                  description: 'ใช้เงินเกินของลูกค้า (Customer Credit)',
                },
                {
                  accountCode: '11-2103',
                  dr: creditZero,
                  cr: creditPayAmount,
                  description: 'ล้างลูกหนี้ค้างชำระ',
                },
              ],
            },
            tx,
          );
        }
      }

      // Update credit balance
      const usedCredit = dRound(dSub(credit, remaining));
      await tx.contract.update({
        where: { id: contractId },
        data: { creditBalance: remaining },
      });

      return {
        allocatedPayments: results,
        creditUsed: usedCredit.toNumber(),
        creditRemaining: remaining.toNumber(),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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

  // ─── Batch CSV Payment Import ────────────────────────
  /**
   * Parse CSV and record payments in batch.
   * Expected CSV format:
   *   contractNumber,installmentNo,amount,paymentMethod,transactionRef,notes,depositAccountCode
   * Last column (depositAccountCode) is optional; falls back to body-level
   * dto.depositAccountCode → user defaultCashAccountCode → 11-1101.
   * First row is header (skipped).
   */
  async importPaymentsFromCsv(
    csvText: string,
    defaultPaymentMethod: string,
    recordedById: string,
    bodyDepositAccountCode?: string,
  ): Promise<{ total: number; success: number; errors: { row: number; message: string }[] }> {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      throw new BadRequestException('CSV ต้องมีอย่างน้อย 1 แถวข้อมูล (ไม่รวม header)');
    }

    // Skip header row
    const dataRows = lines.slice(1);
    const errors: { row: number; message: string }[] = [];
    let success = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = i + 2; // 1-indexed, +1 for header
      const line = dataRows[i].trim();
      if (!line) continue;

      // Parse CSV with proper quoted-field handling (handles commas inside quotes)
      const cols = this.parseCsvLine(line);
      if (cols.length < 3) {
        errors.push({ row, message: 'ข้อมูลไม่ครบ ต้องมีอย่างน้อย contractNumber, installmentNo, amount' });
        continue;
      }

      const [
        contractNumber,
        installmentNoStr,
        amountStr,
        paymentMethod,
        transactionRef,
        notes,
        rowDepositAccountCode,
      ] = cols;
      const installmentNo = parseInt(installmentNoStr, 10);
      const amount = parseFloat(amountStr);

      if (!contractNumber || isNaN(installmentNo) || isNaN(amount) || amount <= 0) {
        errors.push({ row, message: `ข้อมูลไม่ถูกต้อง: contractNumber=${contractNumber}, installmentNo=${installmentNoStr}, amount=${amountStr}` });
        continue;
      }

      // Per-row deposit account: row column > body default > recordPayment fallback
      const depositCode = rowDepositAccountCode?.trim() || bodyDepositAccountCode;
      if (depositCode && !CASH_ACCOUNT_CODES.includes(depositCode as CashAccountCode)) {
        errors.push({
          row,
          message: `บัญชีรับเงินไม่ถูกต้อง: ${depositCode} (รหัสที่อนุญาต: ${CASH_ACCOUNT_CODES.join(', ')})`,
        });
        continue;
      }

      try {
        // Lookup contract by number
        const contract = await this.prisma.contract.findFirst({
          where: { contractNumber, deletedAt: null },
          select: { id: true },
        });
        if (!contract) {
          errors.push({ row, message: `ไม่พบสัญญา ${contractNumber}` });
          continue;
        }

        // C6 fix: CSV idempotency. The previous synthetic
        // `CSV-${Date.now()}-${row}-${Math.random()}` was unique every run, so
        // re-importing the same CSV (e.g. operator retry after partial failure)
        // created duplicate Payments + duplicate JEs. Replace with a
        // content-stable SHA-256 hash of the row's business identity:
        //   contractNumber | installmentNo | amount | paidDate (date-only).
        // Re-importing the same row will compute the same ref, and the
        // existing idempotency check in recordPayment (notes contains
        // `ref:<value>`) will reject it as a duplicate.
        //
        // Round 2 C6 fix: date component MUST be Asia/Bangkok local date.
        // `new Date().toISOString().slice(0, 10)` returns UTC, so a CSV
        // imported at 01:00 BKK (= 18:00 UTC previous day) hashes as
        // yesterday — losing idempotency for ~7 hours every night when the
        // operator retries spanning UTC midnight. en-CA `Intl.DateTimeFormat`
        // outputs `YYYY-MM-DD` in the chosen timeZone (matches getBkkYyyymm
        // pattern from PR #840).
        const bkkDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Bangkok',
        }).format(new Date());
        const stableRef =
          transactionRef ||
          `csv:${createHash('sha256')
            .update(
              [
                contractNumber,
                String(installmentNo),
                amount.toFixed(2),
                bkkDate,
              ].join('|'),
            )
            .digest('hex')
            .slice(0, 32)}`;

        await this.recordPayment(
          contract.id,
          installmentNo,
          amount,
          paymentMethod || defaultPaymentMethod,
          recordedById,
          undefined, // evidenceUrl
          notes || `CSV import row ${row}`,
          stableRef,
          depositCode, // resolves to user default → 11-1101 if undefined
        );
        success++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ row, message });
      }
    }

    this.logger.log(`CSV payment import: ${success} success, ${errors.length} errors out of ${dataRows.length} rows`);
    return { total: dataRows.length, success, errors };
  }

  // ─── Waive late fee (wrapped in transaction to prevent race condition) ─
  async waiveLateFee(
    paymentId: string,
    reason: string,
    userId: string,
    approverId: string,
    context?: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    // T1-C2 — 4-eyes (Segregation of Duties): requester ≠ approver, and
    // approver must be a manager-tier user. Waiver bypass previously let a
    // single accountant self-approve fee writedowns, which our phone-shop
    // margin (~10%) cannot absorb at volume.
    if (!approverId) {
      throw new BadRequestException('ต้องระบุผู้อนุมัติ (approverId)');
    }
    if (approverId === userId) {
      throw new ForbiddenException(
        'ผู้ขอยกเว้นและผู้อนุมัติต้องเป็นคนละคน (Segregation of Duties)',
      );
    }
    const approver = await this.prisma.user.findUnique({
      where: { id: approverId },
      select: { id: true, role: true, isActive: true, deletedAt: true },
    });
    if (!approver || !approver.isActive || approver.deletedAt) {
      throw new NotFoundException('ไม่พบผู้อนุมัติ หรือผู้อนุมัติถูกปิดการใช้งาน');
    }
    const approverAllowed = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'];
    if (!approverAllowed.includes(approver.role)) {
      throw new ForbiddenException(
        `ผู้อนุมัติต้องมีสิทธิ์ OWNER / FINANCE_MANAGER / BRANCH_MANAGER (role ปัจจุบัน: ${approver.role})`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.deletedAt) throw new NotFoundException('ไม่พบรายการชำระ');
      if (payment.lateFeeWaived) throw new BadRequestException('รายการนี้ยกเว้นค่าปรับแล้ว');
      // I5 fix: read lateFee / amountDue / amountPaid through Prisma.Decimal
      // so comparisons + log values cannot drift on large balances. The
      // comparison + log are the only consumers; we keep `originalLateFee`
      // as a number for the legacy unusual-waiver Sentry check below.
      const lateFeeDec = new Prisma.Decimal(payment.lateFee.toString());
      if (lateFeeDec.lte(0)) throw new BadRequestException('รายการนี้ไม่มีค่าปรับ');

      const originalLateFee = lateFeeDec.toDecimalPlaces(2).toNumber();
      const notes = [payment.notes, `ยกเว้นค่าปรับ ${originalLateFee.toLocaleString()} บาท — ${reason}`].filter(Boolean).join(' | ');

      // Check if payment becomes fully paid after waiving late fee
      const totalOwedDec = new Prisma.Decimal(payment.amountDue.toString()); // without late fee
      const amountPaidDec = new Prisma.Decimal(payment.amountPaid.toString());
      const isNowFullyPaid = amountPaidDec.gte(totalOwedDec);

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          lateFee: 0,
          lateFeeWaived: true,
          waivedById: userId,
          waivedAt: new Date(),
          waivedReason: reason,
          waivedApprovedById: approverId,
          waivedAmount: originalLateFee,
          notes,
          ...(isNowFullyPaid && payment.status !== 'PAID' ? { status: 'PAID', paidDate: new Date() } : {}),
        },
      });

      // T3-C4: immutable approval evidence. Columns on Payment (waivedApprovedById,
      // waivedAt) are convenient for queries, but we ALSO persist a separate
      // FeeWaiverApproval row so that any future mutation of the Payment
      // columns leaves the approval audit trail intact. IP + UA help detect
      // "someone else logged in as the manager" attacks.
      await tx.feeWaiverApproval.create({
        data: {
          waiverPaymentId: paymentId,
          approverId,
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent ?? null,
        },
      });

      // Check contract completion inside transaction
      if (isNowFullyPaid && payment.status !== 'PAID') {
        await this.checkContractCompletion(payment.contractId, tx);
      }

      return { updated, originalLateFee, isNowFullyPaid, contractId: payment.contractId, installmentNo: payment.installmentNo };
    });

    // Structured log for late fee waiver observability
    this.structuredLogger.log('payment.lateFeeWaived', {
      paymentId,
      contractId: result.contractId,
      installmentNo: result.installmentNo,
      originalLateFee: result.originalLateFee,
      becameFullyPaid: result.isNowFullyPaid,
      reason,
      userId,
      approverId,
    });

    // T1-C9 — unusual-waiver alarm. Most waivers are a few hundred baht
    // (goodwill, one-off late days). Anything above 5,000 THB is worth a
    // human eyeball on Sentry so finance can spot pattern abuse early.
    if (result.originalLateFee > 5000) {
      Sentry.captureMessage('Large late-fee waiver', {
        level: 'warning',
        tags: { kind: 'finance' },
        extra: {
          waivedBy: userId,
          contractId: result.contractId,
          amount: result.originalLateFee,
          paymentId,
          approverId,
        },
      });
    }

    // Financial audit trail (outside transaction — audit failure shouldn't roll back waiver)
    await this.auditService.logPaymentEvent({
      userId,
      contractId: result.contractId,
      paymentId,
      action: 'LATE_FEE_WAIVED',
      amount: result.originalLateFee,
      installmentNo: result.installmentNo,
      details: {
        reason,
        approverId,
        wasFeeAmount: result.originalLateFee,
        becameFullyPaid: result.isNowFullyPaid,
      },
    });

    return { ...result.updated, originalLateFee: result.originalLateFee };
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

  // ─── Award loyalty points for on-time payment ──────────
  private async awardLoyaltyPoints(
    customerId: string,
    contractId: string,
    paymentId: string,
    amount: number,
    paidDate: Date | null,
    dueDate: Date,
  ) {
    // Only award for on-time payments (ชำระตรงเวลาหรือก่อนกำหนด)
    if (!paidDate || paidDate > dueDate) return;

    const points = Math.floor(amount / 100); // 1 point per 100 baht
    if (points <= 0) return;

    try {
      // Idempotent upsert: paymentId is unique — safe to call multiple times
      await this.prisma.loyaltyPoint.upsert({
        where: { paymentId },
        create: { customerId, paymentId, contractId, points, reason: 'ON_TIME_PAYMENT' },
        update: {}, // Already awarded — do nothing
      });
    } catch (error) {
      this.logger.error(
        `Failed to award loyalty points for payment ${paymentId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Send LINE push notification after successful payment.
   * Sends Flex Message with Quick Reply (afterPayment preset).
   * Respects customer notification preferences.
   */
  private async sendPaymentSuccessLine(
    contractId: string,
    installmentNo: number,
    amount: number,
    paymentMethod: string,
  ): Promise<void> {
    try {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        select: {
          contractNumber: true,
          totalMonths: true,
          customer: { select: { lineIdFinance: true, name: true, notifReceipt: true } },
        },
      });
      if (!contract?.customer?.lineIdFinance || !contract.customer.notifReceipt) return;

      // I6 fix: include deletedAt: null so soft-deleted payments don't
      // inflate the "X / N" counter shown in the LINE receipt.
      const paidCount = await this.prisma.payment.count({
        where: { contractId, status: 'PAID', deletedAt: null },
      });
      const remaining = contract.totalMonths - paidCount;

      const flex = this.flexTemplates.paymentReceipt({
        contractNumber: contract.contractNumber,
        installmentNo,
        totalInstallments: contract.totalMonths,
        amount,
        date: formatDateShort(new Date()),
      });

      // Attach Quick Reply so customer can quickly check balance, receipt, or contract
      flex.quickReply = { items: this.quickReplyService.afterPayment() };

      await this.lineOaService.sendFlexMessage(contract.customer.lineIdFinance, flex, 'line-finance');

      this.logger.log(
        `[LINE] Payment success flex sent for contract ${contract.contractNumber} ` +
          `installment ${installmentNo}/${contract.totalMonths} remaining=${Math.max(0, remaining)}`,
      );
    } catch (err) {
      this.logger.warn(`LINE push failed for contract ${contractId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ─── Promise-to-pay kept-detection ────────────────────
  // Called non-blocking after every payment tx commits. Checks whether any
  // active promise-to-pay cycle is fully satisfied and, if so, marks it kept
  // and auto-unlocks the MDM device.
  private async checkPromiseAfterPayment(contractId: string): Promise<void> {
    if (!this.promiseService || !this.mdmLockService) return;
    const active = await this.promiseService.findActivePromise(contractId);
    if (!active) return;

    const now = new Date();
    const systemUserId = await this.getSystemUserId();

    // H1 + M4 fix: wrap slot resolution + keptPromiseCount increment in a single
    // Serializable transaction so partial failure can't leave slots updated but
    // counter unchanged, and concurrent payments can't double-increment the counter.
    // The callLog.updateMany guard ensures only one concurrent caller promotes the
    // promise to "kept" — the loser's transaction sees keptAt already set and bails out.
    const promoted = await this.prisma.$transaction(
      async (tx) => {
        let allKept = true;
        // N2 fix: targets are cumulative through each slot, and each slot's
        // paidAmount is its own contribution (settlementAmount), not the
        // contract-wide sum. Previously we compared cumulative paid against the
        // per-slot amount alone — slot N would get falsely satisfied as soon as
        // the customer overpaid slot N-1.
        let cumulativeTarget = 0;

        for (const slot of active.slots) {
          const slotAmount = (slot.settlementAmount as Prisma.Decimal).toNumber();
          cumulativeTarget += slotAmount;

          if (slot.keptAt) continue;
          if (slot.brokenAt) {
            allKept = false;
            continue;
          }

          const windowEnd = new Date(slot.settlementDate.getTime() + 1 * 86400 * 1000);
          const cycleStart = active.cycleStartedAt ?? active.createdAt;
          const sum = await tx.payment.aggregate({
            where: {
              contractId,
              deletedAt: null,
              OR: [
                { paidAt: { not: null, gte: cycleStart, lte: windowEnd } },
                { paidDate: { not: null, gte: cycleStart, lte: windowEnd } },
              ],
            },
            _sum: { amountPaid: true },
          });
          const paid = (sum._sum.amountPaid as Prisma.Decimal | null)?.toNumber() ?? 0;

          if (paid >= cumulativeTarget) {
            await tx.promiseSlot.update({
              where: { id: slot.id },
              data: {
                keptAt: now,
                paidAmount: slotAmount as unknown as Prisma.Decimal,
              },
            });
          } else {
            allKept = false;
          }
        }

        if (!allKept) return false;

        // Guarded promotion: only the first caller flips keptAt.
        const guard = await tx.callLog.updateMany({
          where: { id: active.id, keptAt: null },
          data: { keptAt: now },
        });
        if (guard.count === 0) return false;

        await tx.contract.update({
          where: { id: contractId },
          data: { keptPromiseCount: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            action: 'KEPT_PROMISE',
            entity: 'contract',
            entityId: contractId,
            userId: systemUserId,
            newValue: { callLogId: active.id, source: 'PAYMENT_HOOK' },
          },
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (promoted) {
      // External MDM call runs only after tx commits — avoids orphan unlock on rollback.
      await this.mdmLockService!.autoUnlock(contractId, 'CYCLE_KEPT', systemUserId);
    }
  }

  private async getSystemUserId(): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!user) throw new Error('System user not found');
    return user.id;
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

  /**
   * Preview JE lines for a payment without persisting anything.
   * Used by the RecordPaymentWizard frontend to show "Journal Auto" live.
   *
   * Logic mirrors PaymentReceipt2BTemplate but read-only.
   * - If installment NOT yet accrued (accrualJournalEntryId is null):
   *     builds COMBINED 2A+2B+lateFee lines (consolidated posting)
   * - If installment already accrued (cron ran):
   *     builds 2B+lateFee only
   * - Late fee → Cr 42-1103 ค่าปรับชำระล่าช้า (same JE)
   */
  async previewJournal(input: {
    contractId: string;
    installmentNo: number;
    amountReceived: number;
    depositAccountCode: string;
    lateFee?: number;
    case?: string;
    daysToShift?: number;
    splitMode?: string;
  }): Promise<{
    lines: Array<{ accountCode: string; accountName: string; debit: string; credit: string; description: string }>;
    totalDebit: string;
    totalCredit: string;
    isBalanced: boolean;
    rescheduleFeeDisplay?: string;
    /**
     * 2B_ONLY: 2A daily accrual cron has already posted for this installment.
     *   JE clears 11-2103 only.
     * CONSOLIDATED_PAYING_AHEAD: dueDate is in the future — customer is paying
     *   before due. 2A has not yet fired; preview folds 2A+2B into one JE so
     *   the books balance without recognizing revenue early in two passes.
     * CONSOLIDATED_BACKFILL: dueDate is past or today but 2A is missing —
     *   anomaly the daily cron will catch up on the next 00:01 BKK run.
     */
    accrualMode?: '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL';
    dueDate?: string;
  }> {
    const inst = await this.prisma.installmentSchedule.findUnique({
      where: { contractId_installmentNo: { contractId: input.contractId, installmentNo: input.installmentNo } },
      include: { contract: true },
    });
    if (!inst) throw new NotFoundException('ไม่พบงวดชำระ');

    const c = inst.contract;
    const zero = new Prisma.Decimal(0);

    // Per-installment calculations.
    // Use contract.monthlyPayment as source of truth (set by sales workflow,
    // matches what user sees). Derive breakdown so JE always balances.
    const total = new Prisma.Decimal(c.totalMonths);
    const interest = new Prisma.Decimal(c.interestTotal?.toString() ?? '0');
    const monthly = new Prisma.Decimal((c.monthlyPayment ?? 0).toString());

    // VAT preference: explicit contract.vatAmount → /total ; else 7% on (monthlyPayment*total) excl VAT
    const explicitVat = c.vatAmount != null ? new Prisma.Decimal(c.vatAmount.toString()) : null;
    const vatPerInst = explicitVat != null
      ? explicitVat.div(total).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : monthly.div('1.07').times('0.07').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    // installmentExclVat = monthly - vat (so installmentExclVat + vatPerInst === monthly)
    const installmentExclVat = monthly.minus(vatPerInst);
    const interestPerInst = interest.div(total).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const installmentTotal = monthly;

    // Round 2 I3 audit: input.lateFee arrives as `number` from the DTO.
    // `.toString()` is defensive against Decimal constructor surprises on
    // large numbers — only this one site consumes input.lateFee raw, and
    // it's properly wrapped. Other code paths (record/preview controllers,
    // recordPayment service flow) re-read payment.lateFee from the DB which
    // is already Prisma.Decimal. No further coercion sites identified.
    const lateFeeAmount = input.lateFee ? new Prisma.Decimal(input.lateFee.toString()) : zero;

    // Build raw JE lines (code, dr, cr, description)
    const rawLines: { code: string; dr: Prisma.Decimal; cr: Prisma.Decimal; description: string }[] = [];

    // PARTIAL and RESCHEDULE both emit Cr 11-2103 directly — they assume 2A
    // has already accrued the installment into 11-2103. If 2A is missing
    // (paying ahead, cron lag), the JE would credit a zero-balance account.
    // Block here with a clear Thai message so the wizard can prompt user to
    // wait for the next 2A tick instead of silently producing a malformed JE.
    if (
      !inst.accrualJournalEntryId &&
      (input.case === 'PARTIAL' || input.case === 'RESCHEDULE')
    ) {
      throw new BadRequestException(
        `งวดนี้ยังไม่ได้ทำ accrual (2A) — ไม่สามารถใช้ ${input.case === 'PARTIAL' ? 'จ่ายบางส่วน' : 'เลื่อนงวด'} ได้ก่อน accrual กรุณารอรอบ 00:01 น. หรือใช้รับชำระแบบปกติ`,
      );
    }

    // ── RESCHEDULE case (JP6 template preview) ──────────────────────────────
    if (input.case === 'RESCHEDULE') {
      const days = input.daysToShift ?? 0;
      const monthlyPayment = new Prisma.Decimal(c.monthlyPayment.toString());
      // Reschedule fee = installmentTotal / 30 × daysToShift (ROUND_DOWN per spec)
      const rescheduleFee = days > 0
        ? monthlyPayment.div(30).times(days).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN)
        : zero;

      const isSplit = input.splitMode === 'SPLIT';
      const amountReceived = new Prisma.Decimal(input.amountReceived.toString());

      if (isSplit) {
        // 6a — fee advance only (step 1):
        //   Dr depositAccountCode  feeAmount
        //     Cr 21-1103           feeAmount (เงินรับล่วงหน้างวดสุดท้าย)
        const feeAmount = rescheduleFee.gt(zero) ? rescheduleFee : amountReceived;
        rawLines.push({ code: input.depositAccountCode, dr: feeAmount, cr: zero, description: 'รับค่าปรับดิวล่วงหน้า (6a)' });
        rawLines.push({ code: '21-1103', dr: zero, cr: feeAmount, description: 'เงินรับล่วงหน้างวดสุดท้าย' });
      } else {
        // 6b — bundled (installment + fee in one transaction):
        //   Dr depositAccountCode  installmentAmount + feeAmount
        //     Cr 11-2103           installmentAmount
        //     Cr 21-1103           feeAmount
        const bundledTotal = installmentTotal.plus(rescheduleFee);
        rawLines.push({ code: input.depositAccountCode, dr: bundledTotal, cr: zero, description: 'รับชำระงวด + ค่าปรับดิว (6b)' });
        rawLines.push({ code: '11-2103', dr: zero, cr: installmentTotal, description: 'ล้างลูกหนี้ค้างชำระงวด' });
        rawLines.push({ code: '21-1103', dr: zero, cr: rescheduleFee, description: 'เงินรับล่วงหน้างวดสุดท้าย' });
      }

      // Resolve CoA names
      const codes = [...new Set(rawLines.map((l) => l.code))];
      const coaRows = await this.prisma.chartOfAccount.findMany({
        where: { code: { in: codes } },
        select: { code: true, name: true },
      });
      const nameMap = new Map(coaRows.map((r) => [r.code, r.name]));

      let totalDebit = zero;
      let totalCredit = zero;
      for (const l of rawLines) {
        totalDebit = totalDebit.plus(l.dr);
        totalCredit = totalCredit.plus(l.cr);
      }
      const isBalanced = totalDebit.toFixed(2) === totalCredit.toFixed(2);

      return {
        lines: rawLines.map((l) => ({
          accountCode: l.code,
          accountName: nameMap.get(l.code) ?? l.code,
          debit: l.dr.toFixed(2),
          credit: l.cr.toFixed(2),
          description: l.description,
        })),
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        isBalanced,
        rescheduleFeeDisplay: rescheduleFee.toFixed(2),
      };
    }

    // ── PARTIAL case: minimal partial-clear preview ─────────────────────────
    if (input.case === 'PARTIAL') {
      const amountReceived = new Prisma.Decimal(input.amountReceived.toString());
      rawLines.push({ code: input.depositAccountCode, dr: amountReceived, cr: zero, description: 'รับชำระบางส่วน' });
      rawLines.push({ code: '11-2103', dr: zero, cr: amountReceived, description: 'ล้างลูกหนี้ค้างชำระ (บางส่วน)' });

      const codes = [...new Set(rawLines.map((l) => l.code))];
      const coaRows = await this.prisma.chartOfAccount.findMany({
        where: { code: { in: codes } },
        select: { code: true, name: true },
      });
      const nameMap = new Map(coaRows.map((r) => [r.code, r.name]));
      let totalDebit = zero;
      let totalCredit = zero;
      for (const l of rawLines) {
        totalDebit = totalDebit.plus(l.dr);
        totalCredit = totalCredit.plus(l.cr);
      }
      return {
        lines: rawLines.map((l) => ({
          accountCode: l.code,
          accountName: nameMap.get(l.code) ?? l.code,
          debit: l.dr.toFixed(2),
          credit: l.cr.toFixed(2),
          description: l.description,
        })),
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        isBalanced: totalDebit.toFixed(2) === totalCredit.toFixed(2),
      };
    }

    // ── Normal / Overpay / Underpay / EarlyPayoff (existing logic continues) ─
    const amountReceived = new Prisma.Decimal(input.amountReceived.toString());
    const isConsolidated = !inst.accrualJournalEntryId; // 2A not yet run

    // Accrual-mode classification for UI explanation chip:
    //   PAYING_AHEAD   — dueDate is in the future, customer paying early
    //   BACKFILL       — dueDate has passed but 2A still missing (cron lag)
    //   2B_ONLY        — 2A already posted, JE only clears 11-2103
    let accrualMode: '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL';
    if (!isConsolidated) {
      accrualMode = '2B_ONLY';
    } else {
      const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);
      accrualMode = inst.dueDate.getTime() > todayMidnight.getTime()
        ? 'CONSOLIDATED_PAYING_AHEAD'
        : 'CONSOLIDATED_BACKFILL';
    }

    // Dr: cash/bank received (installment total + late fee)
    const totalReceived = amountReceived.plus(lateFeeAmount);

    // ── Advance balance split (mirror recordPayment §Task 4) ────────────────
    // The wizard preview must match what the save actually does — including 21-1103 lines.
    const advanceBalance = new Prisma.Decimal((c.advanceBalance ?? 0).toString());
    const remaining = installmentTotal.plus(lateFeeAmount); // gross owed (no prevPaid in preview)
    const overage = amountReceived.plus(lateFeeAmount).minus(remaining);
    let previewAdvCredit = zero;
    let previewAdvConsume = zero;

    if (overage.gt(new Prisma.Decimal('1.00')) && input.case === 'OVERPAY_ADVANCE') {
      previewAdvCredit = overage;
    } else if (
      amountReceived.plus(lateFeeAmount).lt(remaining) &&
      advanceBalance.gt(zero) &&
      (input.case === undefined || input.case === 'NORMAL')
    ) {
      const gap = remaining.minus(amountReceived.plus(lateFeeAmount));
      previewAdvConsume = Prisma.Decimal.min(advanceBalance, gap);
    }

    // 1. Cash in (skip when 0 — full advance cover edge)
    if (totalReceived.gt(zero)) {
      rawLines.push({ code: input.depositAccountCode, dr: totalReceived, cr: zero, description: 'รับชำระ' });
    }

    // 2. Consume existing advance
    if (previewAdvConsume.gt(zero)) {
      rawLines.push({ code: '21-1103', dr: previewAdvConsume, cr: zero, description: 'หักเงินรับล่วงหน้า' });
    }

    if (isConsolidated) {
      // CONSOLIDATED 2A+2B: Dr 21-2102 + 11-2106 to clear accrual side
      rawLines.push({ code: '21-2102', dr: vatPerInst, cr: zero, description: 'ล้าง VAT รอเรียกเก็บ' });
      rawLines.push({ code: '11-2106', dr: interestPerInst, cr: zero, description: 'ล้าง Unearned รายได้รอตัดบัญชี' });
      // Cr: clear gross receivable, VAT asset, and recognize income
      rawLines.push({ code: '11-2101', dr: zero, cr: installmentExclVat, description: 'ลูกหนี้ Gross (ลด)' });
      rawLines.push({ code: '11-2105', dr: zero, cr: vatPerInst, description: 'VAT รอเรียกเก็บ (ล้าง)' });
      rawLines.push({ code: '21-2101', dr: zero, cr: vatPerInst, description: 'ภาษีขาย ภ.พ.30' });
      rawLines.push({ code: '41-1101', dr: zero, cr: interestPerInst, description: 'รายได้ดอกเบี้ย (รับรู้)' });
    } else {
      // 2B ONLY: installment already accrued, just clear the accrued receivable
      rawLines.push({ code: '11-2103', dr: zero, cr: installmentTotal, description: 'ล้างลูกหนี้ค้างชำระ' });
    }

    // Late fee: Cr 42-1103 if > 0
    if (lateFeeAmount.gt(zero)) {
      rawLines.push({ code: '42-1103', dr: zero, cr: lateFeeAmount, description: 'ค่าปรับชำระล่าช้า' });
    }

    // 5. Park new advance (overpay → 21-1103)
    if (previewAdvCredit.gt(zero)) {
      rawLines.push({ code: '21-1103', dr: zero, cr: previewAdvCredit, description: 'เงินรับล่วงหน้า' });
    }

    // 6. Rounding adjustment (≤1฿ tolerance) — must include for balanced preview
    // This mirrors PaymentReceipt2BTemplate's rounding logic.
    // Skipped for OVERPAY_ADVANCE / advance consume because those clear the diff via 21-1103.
    if (previewAdvCredit.eq(zero) && previewAdvConsume.eq(zero)) {
      const roundingDiff = amountReceived.minus(installmentTotal);
      const tolerance = new Prisma.Decimal('1.00');
      if (roundingDiff.gt(zero) && roundingDiff.lte(tolerance)) {
        rawLines.push({ code: this.roles.code('adj_overpay'), dr: zero, cr: roundingDiff, description: 'กำไรปัดเศษ (Policy C)' });
      } else if (roundingDiff.lt(zero) && roundingDiff.abs().lte(tolerance)) {
        rawLines.push({ code: this.roles.code('adj_underpay'), dr: roundingDiff.abs(), cr: zero, description: 'ส่วนลดเศษสตางค์ (Policy C)' });
      }
    }

    // Resolve account names from CoA
    const codes = [...new Set(rawLines.map((l) => l.code))];
    const coaRows = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes } },
      select: { code: true, name: true },
    });
    const nameMap = new Map(coaRows.map((r) => [r.code, r.name]));

    // Compute totals
    let totalDebit = zero;
    let totalCredit = zero;
    for (const l of rawLines) {
      totalDebit = totalDebit.plus(l.dr);
      totalCredit = totalCredit.plus(l.cr);
    }

    const isBalanced = totalDebit.toFixed(2) === totalCredit.toFixed(2);

    return {
      lines: rawLines.map((l) => ({
        accountCode: l.code,
        accountName: nameMap.get(l.code) ?? l.code,
        debit: l.dr.toFixed(2),
        credit: l.cr.toFixed(2),
        description: l.description,
      })),
      totalDebit: totalDebit.toFixed(2),
      totalCredit: totalCredit.toFixed(2),
      isBalanced,
      accrualMode,
      dueDate: inst.dueDate.toISOString(),
    };
  }
}
