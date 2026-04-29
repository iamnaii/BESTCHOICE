import { Injectable, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { StructuredLoggerService } from '../../common/logger';
import { Prisma, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { ReceiptsService } from '../receipts/receipts.service';
import { AuditService } from '../audit/audit.service';
import { JournalAutoService } from '../journal/journal-auto.service';
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

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly structuredLogger = new StructuredLoggerService(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private receiptsService: ReceiptsService,
    private auditService: AuditService,
    private journalAutoService: JournalAutoService,
    private productsService: ProductsService,
    private lineOaService: LineOaService,
    private flexTemplates: FlexTemplatesService,
    private quickReplyService: QuickReplyService,
    @Optional() private mdmAuto?: MdmAutoService,
    @Optional() @Inject(forwardRef(() => PromiseService)) private promiseService?: PromiseService,
    @Optional() private mdmLockService?: MdmLockService,
  ) {}

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

      // Prevent overpayment: cap amount at what is owed for this installment
      if (d(amount).gt(remaining)) {
        throw new BadRequestException(
          `จำนวนเงินเกินยอดค้างชำระ (ยอดค้าง ${remaining.toNumber().toLocaleString()} บาท, ชำระ ${amount.toLocaleString()} บาท) กรุณาใช้ระบบจัดสรรอัตโนมัติสำหรับการชำระหลายงวด`,
        );
      }
      const totalPaid = dAdd(prevPaid, amount);

      const isPaidInFull = dGte(totalPaid, amountDue);

      // Append transactionRef to notes for idempotency tracking
      const updatedNotes = transactionRef
        ? [notes, `ref:${transactionRef}`].filter(Boolean).join(' | ')
        : (notes || payment.notes);

      const result = await tx.payment.update({
        where: { id: payment.id },
        data: {
          amountPaid: totalPaid,
          paidDate: isPaidInFull ? new Date() : null,
          paymentMethod: paymentMethod as PaymentMethod,
          status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
          recordedById,
          evidenceUrl: evidenceUrl || payment.evidenceUrl,
          notes: updatedNotes,
        },
      });

      // Check if all payments are completed → update contract status
      if (isPaidInFull) {
        await this.checkContractCompletion(contractId, tx);
      }

      // Auto journal entry — only on full payment to avoid partial double-entries.
      // No try/catch: a journal failure must roll back the payment update so the
      // ledger and cash never diverge. (Audit finding J5.)
      if (isPaidInFull) {
        await this.journalAutoService.createPaymentJournal(tx, {
          shopCompanyId,
          financeCompanyId,
          payment: {
            id: result.id,
            installmentNo: result.installmentNo,
            amountPaid: result.amountPaid,
            monthlyPrincipal: result.monthlyPrincipal,
            monthlyInterest: result.monthlyInterest,
            monthlyCommission: result.monthlyCommission,
            vatAmount: result.vatAmount,
            lateFee: result.lateFee,
            lateFeeWaived: result.lateFeeWaived,
            paidDate: result.paidDate,
          },
          contract: { id: contract.id, contractNumber: contract.contractNumber, branchId: contract.branchId },
          userId: recordedById,
        });
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
            ...(isFirstPayment && evidenceUrl ? { evidenceUrl } : {}),
          },
        });

        results.push({ updated, payAmount });
        remaining = dSub(remaining, payAmount);

        // Check contract completion after each full payment
        if (isPaidInFull) {
          await this.checkContractCompletion(contractId, tx);

          // Auto journal entry per fully-paid installment — same pattern as
          // recordPayment(). Errors propagate so the whole tx rolls back.
          // (Audit finding J1: closes the journal coverage gap on the
          // multi-installment auto-allocate path.)
          await this.journalAutoService.createPaymentJournal(tx, {
            shopCompanyId,
            financeCompanyId,
            payment: {
              id: updated.id,
              installmentNo: updated.installmentNo,
              amountPaid: updated.amountPaid,
              monthlyPrincipal: updated.monthlyPrincipal,
              monthlyInterest: updated.monthlyInterest,
              monthlyCommission: updated.monthlyCommission,
              vatAmount: updated.vatAmount,
              lateFee: updated.lateFee,
              lateFeeWaived: updated.lateFeeWaived,
              paidDate: updated.paidDate,
            },
            contract: { id: contract.id, contractNumber: contract.contractNumber, branchId: contract.branchId },
            userId: recordedById,
          });
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
        await this.journalAutoService.createCustomerCreditOverpaymentJournal(tx, {
          paymentId: referencePaymentId,
          contractNumber: contract.contractNumber,
          overpaymentAmount: overpayment,
          userId: recordedById,
          financeCompanyId,
          paidDate: results.length > 0 ? results[results.length - 1].updated.paidDate : new Date(),
        });
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

    return {
      date,
      totalPayments: total,
      totalAmount: Math.round(new Prisma.Decimal(aggregation._sum.amountPaid ?? 0).toNumber()),
      totalLateFees: Math.round(new Prisma.Decimal(aggregation._sum.lateFee ?? 0).toNumber()),
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

        results.push(updated);
        remaining = dSub(remaining, payAmount);

        if (isPaidInFull) {
          await this.checkContractCompletion(contractId, tx);

          // Phase A.1b (audit F-1-004): use createCreditAllocationJournal which
          // debits Customer Credit (21-5101) instead of Cash. Calling
          // createPaymentJournal here would Dr Cash a second time even though
          // no cash was received — credit was already booked when the
          // overpayment originally came in.
          await this.journalAutoService.createCreditAllocationJournal(tx, {
            shopCompanyId,
            financeCompanyId,
            payment: {
              id: updated.id,
              installmentNo: updated.installmentNo,
              amountPaid: updated.amountPaid,
              monthlyPrincipal: updated.monthlyPrincipal,
              monthlyInterest: updated.monthlyInterest,
              monthlyCommission: updated.monthlyCommission,
              vatAmount: updated.vatAmount,
              lateFee: updated.lateFee,
              lateFeeWaived: updated.lateFeeWaived,
              paidDate: updated.paidDate,
            },
            contract: { id: contract.id, contractNumber: contract.contractNumber, branchId: contract.branchId },
            userId: recordedById,
          });
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
    return { creditBalance: Number(contract.creditBalance) };
  }

  // ─── Batch CSV Payment Import ────────────────────────
  /**
   * Parse CSV and record payments in batch.
   * Expected CSV format: contractNumber,installmentNo,amount,paymentMethod,transactionRef,notes
   * First row is header (skipped).
   */
  async importPaymentsFromCsv(
    csvText: string,
    defaultPaymentMethod: string,
    recordedById: string,
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

      const [contractNumber, installmentNoStr, amountStr, paymentMethod, transactionRef, notes] = cols;
      const installmentNo = parseInt(installmentNoStr, 10);
      const amount = parseFloat(amountStr);

      if (!contractNumber || isNaN(installmentNo) || isNaN(amount) || amount <= 0) {
        errors.push({ row, message: `ข้อมูลไม่ถูกต้อง: contractNumber=${contractNumber}, installmentNo=${installmentNoStr}, amount=${amountStr}` });
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

        await this.recordPayment(
          contract.id,
          installmentNo,
          amount,
          paymentMethod || defaultPaymentMethod,
          recordedById,
          undefined, // evidenceUrl
          notes || `CSV import row ${row}`,
          transactionRef || `CSV-${Date.now()}-${row}-${Math.random().toString(36).slice(2, 8)}`,
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
      if (Number(payment.lateFee) <= 0) throw new BadRequestException('รายการนี้ไม่มีค่าปรับ');

      const originalLateFee = roundBaht(Number(payment.lateFee));
      const notes = [payment.notes, `ยกเว้นค่าปรับ ${originalLateFee.toLocaleString()} บาท — ${reason}`].filter(Boolean).join(' | ');

      // Check if payment becomes fully paid after waiving late fee
      const totalOwed = roundBaht(Number(payment.amountDue)); // without late fee
      const amountPaid = roundBaht(Number(payment.amountPaid));
      const isNowFullyPaid = amountPaid >= totalOwed;

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
          customer: { select: { lineId: true, name: true, notifReceipt: true } },
        },
      });
      if (!contract?.customer?.lineId || !contract.customer.notifReceipt) return;

      const paidCount = await this.prisma.payment.count({
        where: { contractId, status: 'PAID' },
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

      await this.lineOaService.sendFlexMessage(contract.customer.lineId, flex);

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
}
