import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import { StructuredLoggerService } from '../../../common/logger';
import { Prisma, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReceiptsService } from '../../receipts/receipts.service';
import { AuditService } from '../../audit/audit.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../../journal/cpa-templates/payment-receipt.template';
import { Vat60dayReversalTemplate } from '../../journal/cpa-templates/vat-60day-reversal.template';
import { ProductsService } from '../../products/products.service';
import { BadDebtService } from '../../accounting/bad-debt.service';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { ensureInstallmentSchedules } from '../../../utils/installment-schedule.util';
import { BUSINESS_RULES } from '../../../utils/config.util';
import { d, dAdd, dSub, dMul, dRound, dGte } from '../../../utils/decimal.util';
import { computeBracketLateFee } from '../../../utils/late-fee.util';
import { PaymentCase } from '../dto/payment.dto';
import {
  resolveUserDefaultCashAccount,
  resolveFinanceCompanyId,
  resolveShopCompanyId,
  checkContractCompletion,
} from './payment-helpers';

/**
 * Post-commit side-effects the orchestrator fires AFTER its money $tx returns
 * (the I3 ordering). Dispatched through the facade so spied/optional deps
 * (loyalty/LINE via PostCommitHooks, mdmAuto + promiseService @Optional fields,
 * the promise-kept hook) resolve against the same instance the specs use. NONE
 * of these may roll back the committed payment.
 */
export interface OrchestratorPostCommitHost {
  awardLoyaltyPoints(
    customerId: string,
    contractId: string,
    paymentId: string,
    amount: number,
    paidDate: Date | null,
    dueDate: Date,
  ): Promise<void>;
  sendPaymentSuccessLine(
    contractId: string,
    installmentNo: number,
    amount: number,
    paymentMethod: string,
  ): Promise<void>;
  /** Legacy "all overdue cleared" MDM auto-unlock (skipped when a promise cycle is active). */
  runMdmAutoUnlock(contractId: string): Promise<void>;
  checkPromiseAfterPayment(contractId: string): Promise<void>;
}

/**
 * REGULATED CORE — the 3 Serializable money $transactions (recordPayment,
 * autoAllocatePayment, applyCreditBalance). Each posts the receipt JE via the
 * PaymentReceiptTemplate primitive + VAT-60-day reversal + ECL stage-reverse
 * (recordPayment) inside ONE atom; autoAllocate also does the overpayment
 * Dr cash / Cr 21-5101 createAndPost + receipt generation INSIDE its tx.
 *
 * Bodies moved VERBATIM from the legacy PaymentsService — only `this.<dep>`
 * resolution, helper calls (now stateless, tx-aware) and post-commit dispatch
 * through {@link OrchestratorPostCommitHost} changed. No tx ever crosses a seam.
 * Constructed internally by PaymentsService.
 */
@Injectable()
export class PaymentReceiptOrchestrator {
  private readonly logger = new Logger('PaymentsService');
  private readonly structuredLogger = new StructuredLoggerService('PaymentsService');

  constructor(
    private prisma: PrismaService,
    private receiptsService: ReceiptsService,
    private auditService: AuditService,
    private journalAutoService: JournalAutoService,
    private productsService: ProductsService,
    private badDebtService: BadDebtService,
    private paymentReceiptTemplate: PaymentReceiptTemplate,
    private vat60Reversal: Vat60dayReversalTemplate,
    private host: OrchestratorPostCommitHost,
  ) {}

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

    // CR-7: Validate payment date is not in a closed (FINANCE) accounting period.
    await validatePeriodOpen(this.prisma, new Date(), await resolveFinanceCompanyId(this.prisma));

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
    const resolvedDepositAccountCode = depositAccountCode ?? (await resolveUserDefaultCashAccount(this.prisma, recordedById));

    // F-3-027 part 2/3 + Phase A.1b: resolve FINANCE + SHOP companyIds BEFORE
    // the transaction so both can be passed explicitly to the payment JE.
    // FINANCE = HP receivable / interest / VAT side; SHOP = commission income side.
    const financeCompanyId = await resolveFinanceCompanyId(this.prisma);
    const shopCompanyId = await resolveShopCompanyId(this.prisma);

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

      // Real-time late fee: flat-bracket model (D2, owner 2026-06-25 — no per-day,
      // no 5% cap). Set = bracket (NOT max(stored, bracket)) so this path agrees
      // with the overdue cron's retroactive downgrade. Skip waived.
      let lateFee = d(payment.lateFee);
      if (!payment.lateFeeWaived && payment.dueDate < new Date()) {
        const daysOverdue = Math.floor((Date.now() - payment.dueDate.getTime()) / (1000 * 60 * 60 * 24));
        const [t1, t2, minDays] = await Promise.all([
          tx.systemConfig.findUnique({ where: { key: 'late_fee_tier1_amount' } }),
          tx.systemConfig.findUnique({ where: { key: 'late_fee_tier2_amount' } }),
          tx.systemConfig.findUnique({ where: { key: 'late_fee_tier2_min_days' } }),
        ]);
        const bracketFee = computeBracketLateFee({
          daysOverdue,
          tier1Amount: t1 ? d(t1.value) : BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT,
          tier2Amount: t2 ? d(t2.value) : BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT,
          tier2MinDays: minDays ? Number(minDays.value) : BUSINESS_RULES.LATE_FEE_TIER2_MIN_DAYS,
        });
        if (!bracketFee.eq(lateFee)) {
          lateFee = bracketFee;
          await tx.payment.update({ where: { id: payment.id }, data: { lateFee } });
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
        // D1 (owner 2026-06-25): auto-route overpay >1฿ to advance (Cr 21-1103)
        // WITHIN a ceiling = multiplier × installment amountDue. Above the ceiling
        // it's likely a data-entry typo → still require explicit OVERPAY_ADVANCE.
        const multCfg = await tx.systemConfig.findUnique({ where: { key: 'overpay_advance_auto_max_multiplier' } });
        const multiplier = multCfg ? d(multCfg.value) : d(2);
        const autoCeiling = dMul(d(payment.amountDue), multiplier);
        if (overage.gt(autoCeiling) && paymentCase !== 'OVERPAY_ADVANCE') {
          throw new BadRequestException(
            `จำนวนเงินเกินยอดค้างชำระมาก (ยอดค้าง ${remaining.toNumber().toLocaleString()} บาท, ชำระ ${amount.toLocaleString()} บาท) — เกินเพดานอัตโนมัติ กรุณายืนยันด้วย case 'OVERPAY_ADVANCE' หากตั้งใจเก็บเป็นเงินรับล่วงหน้า`,
          );
        }
        advanceCredit = overage;
        this.logger?.log?.(
          `Overpay ${overage.toFixed(2)}฿ auto-routed to advance (contract ${contractId}, inst ${installmentNo})`,
        );
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
        (paymentCase === 'OVERPAY_ADVANCE' || advanceCredit.gt(0)) ? remaining : dAdd(prevPaid, amount).plus(advanceConsume);

      const isPaidInFull =
        (paymentCase === 'OVERPAY_ADVANCE' || advanceCredit.gt(0)) ? true : dGte(recordedAmountPaid, amountDue);

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
        await checkContractCompletion(this.prisma, this.productsService, this.logger, contractId, tx);
      }

      // Phase A.4b: replaced createPaymentJournal (old stub) with PaymentReceipt2BTemplate.
      // Template is called on full payment OR partial payment (isPartialClear).
      // It runs inside the same $transaction so a JE failure rolls back the
      // Payment.update — no orphan ledger entries.
      if (isPaidInFull || isPartialClear) {
        // Lazy-gen schedule for legacy (pre-#753) contracts so the 2B receipt
        // JE can post — prevents an orphan PAID-without-ledger row. Idempotent:
        // a no-op when rows already exist. Runs inside the same serializable tx.
        await ensureInstallmentSchedules(tx, contract.id);
        const instSched = await tx.installmentSchedule.findUnique({
          where: {
            contractId_installmentNo: {
              contractId: contract.id,
              installmentNo: result.installmentNo,
            },
          },
          select: { id: true, vat60dayJournalEntryId: true },
        });
        if (instSched) {
          // PR-843/I2 Phase 3 3a — post the receipt via the PaymentReceiptTemplate
          // primitive (replaces the legacy PaymentReceipt2BTemplate in this path).
          // The primitive reconstructs prior cleared (incl. legacy 2B partials),
          // so passing the per-call DELTA is correct: a completion of a prior
          // partial now clears ONLY the remaining delta instead of re-clearing
          // the full installmentTotal (the old delta-vs-cumulative bug).
          // isFinalReceipt = !isPartialClear (the completing receipt closes it).
          // lateFee still forwarded so the Cr 42-1103 income leg is emitted.
          // Runs inside the same tx so a JE failure rolls back the Payment.update.
          await this.paymentReceiptTemplate.execute(
            {
              installmentScheduleId: instSched.id,
              delta: new Prisma.Decimal(amount.toString()),
              debitAccountCode: resolvedDepositAccountCode,
              toleranceApproverId,
              paymentId: result.id,
              advanceCredit: advanceCredit.gt(0) ? advanceCredit : undefined,
              advanceConsume: advanceConsume.gt(0) ? advanceConsume : undefined,
              isFinalReceipt: !isPartialClear,
              lateFee: lateFee.gt(0) ? lateFee : undefined,
              // PR-843/I2 Phase 5b — auto-approve a ≤1฿ underpay-close ONLY when the
              // payer covered the full billed obligation (cash + consumed advance ≥
              // remaining = amountDue+lateFee−prevPaid). In that case any ≤1฿ residual
              // is a pure amountDue↔installmentTotal rounding artifact, not a customer
              // underpayment, so it routes to 52-1104 without an approver. A GENUINE
              // ≤1฿ customer underpayment (amount+advance < remaining) leaves this
              // false → the toleranceApproverId requirement stands.
              autoApproveSystemRounding: dGte(dAdd(d(amount), advanceConsume), remaining),
            },
            tx,
          );

          // VAT-60-day reversal (MANDATORY parity with the old 2B). The legacy
          // 2B template triggered Vat60dayReversalTemplate internally when the
          // installment carried a 60-day mandatory VAT JE; the primitive does
          // not, so trigger it here inside the same tx.
          if (instSched.vat60dayJournalEntryId) {
            await this.vat60Reversal.execute(instSched.id, tx);
          }

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
          // Even after lazy-gen the row is absent — a genuine data anomaly
          // (totalMonths<=0, or installmentNo beyond the schedule). Do NOT
          // silently skip and do NOT roll back the customer's real payment.
          // Alarm so accounting posts the missing receipt JE manually.
          Sentry.captureException(
            new Error(
              'PAID installment has no postable 2B JE (no InstallmentSchedule after lazy-gen)',
            ),
            {
              level: 'error',
              tags: { module: 'payments', flow: '2b-receipt' },
              extra: {
                contractId: contract.id,
                installmentNo: result.installmentNo,
                paymentId: result.id,
              },
            },
          );
          this.logger.error(
            `PaymentReceipt2B UNPOSTABLE — no InstallmentSchedule for contractId=${contract.id} installmentNo=${result.installmentNo} (Sentry-alarmed; manual reconcile needed)`,
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
        await this.host.awardLoyaltyPoints(
          capturedCustomerId,
          contractId,
          updated.id,
          amount,
          updated.paidDate,
          capturedDueDate,
        );
      }

      // LINE push notification (non-blocking)
      await this.host.sendPaymentSuccessLine(contractId, installmentNo, amount, paymentMethod);
    }

    // M3 fix: only run the legacy "all overdue cleared" auto-unlock when there
    // is no active promise-to-pay cycle. When there is an active promise, the
    // checkPromiseAfterPayment hook (below) handles the unlock via its own
    // CYCLE_KEPT path — running both racied two unlock requests per payment.
    await this.host.runMdmAutoUnlock(contractId);

    // Promise-to-pay kept-detection — runs AFTER the payment tx commits so
    // MDM/audit failures cannot roll back the payment row.
    this.host.checkPromiseAfterPayment(contractId).catch((err) => {
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
    const financeCompanyId = await resolveFinanceCompanyId(this.prisma);
    const shopCompanyId = await resolveShopCompanyId(this.prisma);

    // W2 fix: resolve the deposit-account code for the recorder ONCE (mirrors
    // recordPayment line ~160). Previously the per-installment Payment.update
    // omitted depositAccountCode, so the downstream JE fell back to '11-1101'
    // (สุทธินีย์) regardless of who actually collected the money.
    const resolvedDepositAccountCode = await resolveUserDefaultCashAccount(this.prisma, recordedById);

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

        // Effective late fee owed on this installment, honouring lateFeeWaived→0.
        // This is the SAME value the owed-computation below uses, and the SAME
        // value forwarded to the PaymentReceiptTemplate primitive so the
        // Cr 42-1103 income leg matches the principal owed. (autoAllocate does
        // not recompute the cap like recordPayment — it trusts the persisted
        // payment.lateFee, which the waive flow already zeroes when waived.)
        const lateFeeOwed = payment.lateFeeWaived ? d(0) : d(payment.lateFee);
        const amountDue = dRound(dSub(dAdd(payment.amountDue, lateFeeOwed), payment.amountPaid));
        const payAmount = dRound(Prisma.Decimal.min(remaining, amountDue));
        const totalPaid = dRound(dAdd(payment.amountPaid, payAmount));
        const isPaidInFull = dGte(totalPaid, dRound(dAdd(payment.amountDue, lateFeeOwed)));

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
          await checkContractCompletion(this.prisma, this.productsService, this.logger, contractId, tx);
        }

        // PR-843/I2 Phase 3 3c — post the receipt via the PaymentReceiptTemplate
        // primitive (replaces the legacy PaymentReceipt2BTemplate in this path),
        // on EVERY iteration (partial AND full), not only on full payment.
        //   - delta = payAmount (the DELTA cleared THIS iteration) — NOT the
        //     cumulative updated.amountPaid the old 2B passed, which would
        //     re-clear any prior partial when this iteration completes it.
        //   - lateFee = lateFeeOwed (honours lateFeeWaived→0). The primitive
        //     reconstructs prior late-fee cleared, so passing the full owed
        //     fee on each receipt clears only the uncovered remainder.
        //   - isFinalReceipt = isPaidInFull (enables the ≤1฿ underpay close on
        //     the completing receipt; partials stay open).
        // This now LEDGERS partials (defect 2) inside the same serializable tx,
        // so a JE failure rolls back the Payment.update — no orphan ledger rows.
        // No toleranceApproverId is passed here — see the documented Phase-5
        // 2A-trueup-residual seam (auto paths cannot approve a ≤1฿ underpay).
        if (payAmount.gt(0)) {
          // Lazy-gen schedule for legacy (pre-#753) contracts so the 2B receipt
          // JE can post — prevents an orphan PAID-without-ledger row. Idempotent:
          // a no-op when rows already exist. Runs inside the same serializable tx.
          await ensureInstallmentSchedules(tx, contract.id);
          const instSched = await tx.installmentSchedule.findUnique({
            where: {
              contractId_installmentNo: {
                contractId: contract.id,
                installmentNo: updated.installmentNo,
              },
            },
            select: { id: true, vat60dayJournalEntryId: true },
          });
          if (instSched) {
            await this.paymentReceiptTemplate.execute(
              {
                installmentScheduleId: instSched.id,
                delta: new Prisma.Decimal(payAmount.toString()),
                // W2 fix: use the resolvedDepositAccountCode that we just
                // wrote on Payment.update — previously the 2B read the field
                // off the in-memory Prisma return value which may not yet
                // reflect the same value (and read '11-1101' fallback).
                debitAccountCode: updated.depositAccountCode ?? resolvedDepositAccountCode,
                lateFee: lateFeeOwed.gt(0) ? lateFeeOwed : undefined,
                isFinalReceipt: isPaidInFull,
                paymentId: updated.id,
                // PR-843/I2 Phase 5b — autoAllocate always clears the FULL owed
                // amountDue per installment (payAmount = min(remaining, amountDue),
                // never a deliberate customer underpayment), so any ≤1฿ residual on
                // the last installment is a system amountDue↔installmentTotal rounding
                // artifact → auto-approve the 52-1104 close (no approver available on
                // this path).
                autoApproveSystemRounding: true,
              },
              tx,
            );

            // VAT-60-day reversal (MANDATORY parity with the old 2B). The legacy
            // 2B template triggered Vat60dayReversalTemplate internally when the
            // installment carried a 60-day mandatory VAT JE; the primitive does
            // not, so trigger it here inside the same tx.
            if (instSched.vat60dayJournalEntryId) {
              await this.vat60Reversal.execute(instSched.id, tx);
            }
          } else {
            // Genuine data anomaly even after lazy-gen — alarm, never silently
            // skip a PAID installment's ledger entry. Payment stays PAID.
            Sentry.captureException(
              new Error(
                'PAID installment has no postable 2B JE (bulk; no InstallmentSchedule after lazy-gen)',
              ),
              {
                level: 'error',
                tags: { module: 'payments', flow: '2b-receipt-bulk' },
                extra: {
                  contractId: contract.id,
                  installmentNo: updated.installmentNo,
                  paymentId: updated.id,
                },
              },
            );
            this.logger.error(
              `PaymentReceipt2B UNPOSTABLE (bulk) — no InstallmentSchedule for contractId=${contract.id} installmentNo=${updated.installmentNo} (Sentry-alarmed; manual reconcile needed)`,
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
            // FINAL-REVIEW (minor) — the JE `reference` must be a fresh UUID, never
            // `referencePaymentId`. On an autoAllocate retry the same payment id would
            // collide with itself on the partial-unique index `journal_entries_ref_unique`.
            // metadata.paymentId keeps the payment→JE trace (now purely informational —
            // void/refund no longer reverse this JE after the BLOCKER 2 tag filter).
            reference: randomUUID(),
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
    this.host.checkPromiseAfterPayment(contractId).catch((err) => {
      this.logger.error('Promise-kept hook failed (non-blocking)', err);
      Sentry.captureException(err, { tags: { hook: 'checkPromiseAfterPayment', contractId } });
    });

    return allocationResult;
  }

  // ─── Apply credit balance to next pending installment ─
  async applyCreditBalance(contractId: string, recordedById: string) {
    // F-3-027 part 2/3 + Phase A.1b: resolve FINANCE + SHOP companyIds once
    // before the tx so the per-installment JE calls below use them.
    const financeCompanyId = await resolveFinanceCompanyId(this.prisma);
    const shopCompanyId = await resolveShopCompanyId(this.prisma);

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

        // Effective late fee owed on this installment, honouring lateFeeWaived→0
        // (parity with autoAllocate). The waive flow already zeroes payment.lateFee
        // when it sets lateFeeWaived=true, so this is defence-in-depth — the owed
        // computation below is numerically unchanged. Forwarded to the primitive
        // so the Cr 42-1103 income leg matches the principal owed.
        const lateFeeOwed = payment.lateFeeWaived ? d(0) : d(payment.lateFee);
        const amountDue = dRound(dSub(dAdd(payment.amountDue, lateFeeOwed), payment.amountPaid));
        const payAmount = dRound(Prisma.Decimal.min(remaining, amountDue));
        const totalPaid = dRound(dAdd(payment.amountPaid, payAmount));
        const isPaidInFull = dGte(totalPaid, dRound(dAdd(payment.amountDue, lateFeeOwed)));

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
          await checkContractCompletion(this.prisma, this.productsService, this.logger, contractId, tx);
        }

        // PR-843/I2 Phase 3 3d — post the credit-application receipt via the
        // PaymentReceiptTemplate primitive (replaces the custom inline
        // Dr 21-5101 / Cr 11-2103 JE that posted ONLY on full payment).
        //   - debitAccountCode = '21-5101' (customer credit, NOT cash) — the cash
        //     was already booked when the overpayment was originally received
        //     (audit finding F-1-004); this only reclasses credit → receivable.
        //   - delta = payAmount (the DELTA applied THIS allocation). The primitive
        //     reconstructs prior cleared (incl. legacy 2B partials + prior receipts),
        //     so a completion of a prior partial clears ONLY the remaining delta —
        //     same C4 delta-vs-cumulative fix the old code carried, now centralised.
        //   - lateFee = lateFeeOwed → now splits to Cr 42-1103 (was implicitly
        //     lumped into the Cr 11-2103 clear). BEHAVIOUR CHANGE flagged for
        //     accountant sign-off: a credit-funded late fee now books as 42-1103
        //     income; the Dr 21-5101 total (= payAmount) is unchanged.
        //   - isFinalReceipt = isPaidInFull (enables the ≤1฿ underpay close on the
        //     completing receipt; partials stay open).
        // MOVED OUTSIDE the isPaidInFull guard so PARTIAL credit applications are
        // now LEDGERED too (was: full-only). Runs inside the same serializable tx
        // so a JE failure rolls back the Payment.update — no orphan ledger rows.
        // tag flips 'credit-allocation'→'receipt' (the primitive's tag): no
        // production consumer keys on 'credit-allocation' (void/refund/data-audit
        // find this JE via metadata.paymentId), and reconstructPrior now counts a
        // credit application as prior-cleared for any subsequent receipt.
        if (payAmount.gt(0)) {
          // Lazy-gen schedule for legacy (pre-#753) contracts so the credit
          // receipt JE can post — prevents an orphan applied-credit-without-ledger
          // row. Idempotent: a no-op when rows already exist. Same serializable tx.
          await ensureInstallmentSchedules(tx, contract.id);
          const instSched = await tx.installmentSchedule.findUnique({
            where: {
              contractId_installmentNo: {
                contractId: contract.id,
                installmentNo: updated.installmentNo,
              },
            },
            select: { id: true, vat60dayJournalEntryId: true },
          });
          if (instSched) {
            await this.paymentReceiptTemplate.execute(
              {
                installmentScheduleId: instSched.id,
                delta: new Prisma.Decimal(payAmount.toString()),
                debitAccountCode: '21-5101',
                lateFee: lateFeeOwed.gt(0) ? lateFeeOwed : undefined,
                isFinalReceipt: isPaidInFull,
                paymentId: updated.id,
                // PR-843/I2 Phase 5b — applyCreditBalance always clears the FULL owed
                // amountDue per installment (payAmount = min(remaining, amountDue)), so
                // any ≤1฿ residual on the last installment is a system rounding artifact
                // → auto-approve the 52-1104 close (no approver available on this path).
                autoApproveSystemRounding: true,
              },
              tx,
            );

            // VAT-60-day reversal (MANDATORY parity with the old 2B/receipt path).
            // When the installment carries a 60-day mandatory VAT JE, the primitive
            // does not reverse it; trigger it here inside the same tx.
            if (instSched.vat60dayJournalEntryId) {
              await this.vat60Reversal.execute(instSched.id, tx);
            }
          } else {
            // Genuine data anomaly even after lazy-gen — alarm, never silently
            // skip an applied-credit installment's ledger entry. Payment stays PAID.
            Sentry.captureException(
              new Error(
                'Applied-credit installment has no postable 2B JE (credit; no InstallmentSchedule after lazy-gen)',
              ),
              {
                level: 'error',
                tags: { module: 'payments', flow: '2b-receipt-credit' },
                extra: {
                  contractId: contract.id,
                  installmentNo: updated.installmentNo,
                  paymentId: updated.id,
                },
              },
            );
            this.logger.error(
              `PaymentReceipt2B UNPOSTABLE (credit) — no InstallmentSchedule for contractId=${contract.id} installmentNo=${updated.installmentNo} (Sentry-alarmed; manual reconcile needed)`,
            );
          }
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
}
