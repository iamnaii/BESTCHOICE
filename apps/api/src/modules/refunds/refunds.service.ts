import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipts/receipt-types.constants';
import {
  assertPaymentApprovalPermission,
  getPaymentApprovalPermissions,
  PAYMENT_APPROVAL_USER_ROLES,
  type ResolvedPaymentApprovalPermissions,
} from '../payments/services/payment-approval-permissions';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import {
  RequestRefundDto,
  MarkRefundReversedDto,
  RejectRefundDto,
  MarkRefundFailedDto,
} from './dto/refund.dto';

/**
 * Refund workflow — T1-C1 / P2Q7=F (bank reversal policy).
 *
 * The company does NOT pay refunds from its own bank. Staff call the bank to
 * reverse the original charge back to the customer. This service is the
 * bookkeeping layer: one row per refund request, one approval slot, one
 * bank-confirmation slot. Every state change goes to AuditLog.
 *
 * Approval uses current per-user REFUND grants and branch scope.
 * SoD: another account approves; OWNER self-approval requires a reason.
 * Bank confirmation remains restricted to current OWNER / FINANCE_MANAGER.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);
  static readonly APPROVER_ROLES = ['OWNER', 'FINANCE_MANAGER'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly receiptVoidReversalTemplate: ReceiptVoidReversalTemplate,
  ) {}

  async requestRefund(dto: RequestRefundDto, userId: string) {
    return this.financialTransaction(async (tx) => {
      const actor = await this.refundActor(tx, userId);
      const payment = await tx.payment.findUnique({
        where: { id: dto.paymentId },
        include: { refunds: { where: { deletedAt: null } } },
      });
      if (!payment || payment.deletedAt) {
        throw new NotFoundException('ไม่พบรายการชำระเงิน');
      }
      await this.assertContractAccess(tx, actor, payment.contractId);
      if (payment.status !== 'PAID' && payment.status !== 'PARTIALLY_PAID') {
        throw new BadRequestException(
          `ขอคืนเงินได้เฉพาะงวดที่ชำระแล้ว (สถานะปัจจุบัน: ${payment.status})`,
        );
      }

      const openRefund = payment.refunds.find(
        (r) => r.status === 'REQUESTED' || r.status === 'APPROVED',
      );
      if (openRefund) {
        throw new BadRequestException(
          'มีคำขอคืนเงินที่ยังไม่ปิดสำหรับงวดนี้ — กรุณาจัดการคำขอเดิมก่อน',
        );
      }

      // Total not-yet-failed/rejected refunds + this request must not exceed paid.
      const alreadyRefunded = payment.refunds
        .filter((r) => r.status === 'PROCESSED')
        .reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));
      const refundable = await this.refundableCash(tx, payment);
      const remaining = refundable.amount.minus(alreadyRefunded);
      if (new Prisma.Decimal(dto.amount).gt(remaining)) {
        throw new BadRequestException(
          `จำนวนเงินคืน (${dto.amount.toLocaleString()}) เกินยอดคงเหลือที่คืนได้ ` +
            `(${remaining.toFixed(2)} บาท)`,
        );
      }
      // Full refunds return the actual cash shown on the installment receipts.
      // amountPaid also contains approved shortage/advance relief and is not cash.
      if (refundable.amount.lte(0) || !new Prisma.Decimal(dto.amount).equals(refundable.amount)) {
        throw new BadRequestException(
          'รองรับเฉพาะการคืนเงินเต็มจำนวนที่รับจริงตามใบเสร็จของงวด — การคืนบางส่วนยังไม่รองรับ',
        );
      }

      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          contractId: payment.contractId,
          amount: new Prisma.Decimal(dto.amount),
          reason: dto.reason,
          status: 'REQUESTED',
          requestedById: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'REFUND_REQUESTED',
          entity: 'Refund',
          entityId: refund.id,
          newValue: {
            paymentId: payment.id,
            contractId: payment.contractId,
            amount: dto.amount,
            reason: dto.reason,
          },
        },
      });

      return refund;
    });
  }

  async approveRefund(
    refundId: string,
    userId: string,
    _userRole: string,
    approvalReason?: string,
  ) {
    return this.financialTransaction(async (tx) => {
      const actor = await this.refundActor(tx, userId, true);
      const refund = await tx.refund.findUnique({ where: { id: refundId } });
      if (!refund || refund.deletedAt) throw new NotFoundException('ไม่พบคำขอคืนเงิน');
      await this.assertContractAccess(tx, actor, refund.contractId);
      if (refund.status !== 'REQUESTED') {
        throw new BadRequestException(
          `อนุมัติได้เฉพาะคำขอสถานะ REQUESTED (สถานะปัจจุบัน: ${refund.status})`,
        );
      }
      await this.assertCurrentRefundAmount(tx, refund);
      const reason = approvalReason?.trim() || null;
      const ownerSelfApproval = refund.requestedById === userId && actor.role === 'OWNER';
      if (refund.requestedById === userId && !ownerSelfApproval) {
        throw new ForbiddenException('ผู้อนุมัติต้องไม่ใช่ผู้ขอคืนเงิน');
      }
      if (ownerSelfApproval && !reason) {
        throw new BadRequestException('เจ้าของต้องระบุเหตุผลเมื่ออนุมัติคำขอคืนเงินของตนเอง');
      }
      const cas = await tx.refund.updateMany({
        where: { id: refundId, status: 'REQUESTED', deletedAt: null },
        data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
      });
      if (cas.count !== 1) {
        throw new ConflictException('คำขอคืนเงินถูกเปลี่ยนสถานะโดยผู้อื่นแล้ว — กรุณาโหลดใหม่');
      }
      const updated = await tx.refund.findUnique({ where: { id: refundId } });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'REFUND_APPROVED',
          entity: 'Refund',
          entityId: refundId,
          oldValue: { status: 'REQUESTED' },
          newValue: { status: 'APPROVED', approvedById: userId, reason, ownerSelfApproval },
        },
      });
      return updated;
    });
  }

  async rejectRefund(refundId: string, dto: RejectRefundDto, userId: string, _userRole: string) {
    return this.financialTransaction(async (tx) => {
      const actor = await this.refundActor(tx, userId, true);
      const refund = await tx.refund.findUnique({ where: { id: refundId } });
      if (!refund || refund.deletedAt) throw new NotFoundException('ไม่พบคำขอคืนเงิน');
      await this.assertContractAccess(tx, actor, refund.contractId);
      if (refund.status !== 'REQUESTED') {
        throw new BadRequestException('ปฏิเสธได้เฉพาะคำขอสถานะ REQUESTED');
      }
      const reason = dto.reason.trim();
      if (!reason) throw new BadRequestException('ต้องระบุเหตุผลการปฏิเสธ');
      if (refund.requestedById === userId && actor.role !== 'OWNER') {
        throw new ForbiddenException('ผู้ปฏิเสธต้องไม่ใช่ผู้ขอคืนเงิน');
      }
      const cas = await tx.refund.updateMany({
        where: { id: refundId, status: 'REQUESTED', deletedAt: null },
        data: {
          status: 'REJECTED',
          rejectedById: userId,
          rejectedAt: new Date(),
          rejectedReason: reason,
        },
      });
      if (cas.count !== 1)
        throw new ConflictException('คำขอคืนเงินถูกเปลี่ยนสถานะโดยผู้อื่นแล้ว — กรุณาโหลดใหม่');
      await tx.auditLog.create({
        data: {
          userId,
          action: 'REFUND_REJECTED',
          entity: 'Refund',
          entityId: refundId,
          oldValue: { status: 'REQUESTED' },
          newValue: { status: 'REJECTED', rejectedById: userId, rejectedReason: reason },
        },
      });
      return tx.refund.findUnique({ where: { id: refundId } });
    });
  }

  /** Called after staff manually confirms with the bank that reversal went through. */
  async markReversed(
    refundId: string,
    dto: MarkRefundReversedDto,
    userId: string,
    _userRole: string,
  ) {
    return this.financialTransaction(async (tx) => {
      const actor = await this.refundActor(tx, userId, true, true);
      const refund = await tx.refund.findUnique({ where: { id: refundId } });
      if (!refund || refund.deletedAt) throw new NotFoundException('ไม่พบคำขอคืนเงิน');
      await this.assertContractAccess(tx, actor, refund.contractId);
      if (refund.status !== 'APPROVED') {
        throw new BadRequestException(
          `บันทึกว่าธนาคาร reverse สำเร็จได้เฉพาะคำขอสถานะ APPROVED ` +
            `(สถานะปัจจุบัน: ${refund.status})`,
        );
      }
      // T1-C8: bank reversal is write-once. If bankReversalRef is already set
      // (or the lock timestamp exists), reject further writes outright so staff
      // can't silently edit the bank evidence after the fact.
      if (refund.bankReversalLockedAt || refund.bankReversalRef) {
        throw new BadRequestException(
          'ข้อมูล bank reversal ถูกล็อคแล้วหลังจากบันทึกครั้งแรก — แก้ไขไม่ได้',
        );
      }

      await this.assertCurrentRefundAmount(tx, refund);

      const now = new Date();

      // PR-843/I2 Phase 3 PR 3.1 — find ALL POSTED receipt JEs of this payment and
      // reverse EACH. The epic posts MULTIPLE receipt JEs per Payment (a partial then
      // a completion); each carries a fresh unique `reference`, so the old
      // `referenceId == paymentId` findFirst found at most ONE and left the other
      // receipt's Cr 11-2103 un-reversed. The canonical payment→JE link is
      // `metadata.paymentId`, stamped by every receipt path (the primitive, the legacy
      // 2B full/2B-split-final templates, and applyCreditBalance). Refunds are
      // always-full (owner-confirmed #1164), so reversing ALL receipt JEs = full
      // reversal — the correct semantics. Backward-compatible: a single-receipt payment
      // returns one JE → one reversal (same as before).
      // FINAL-REVIEW BLOCKER 2 — restrict the reversal to TRUE receivable-clearing
      // receipt JEs. autoAllocate's overpayment JE shares the same metadata.paymentId
      // but carries tag:'overpayment-credit' (Dr cash / Cr 21-5101 customer credit);
      // reversing it on a refund would phantom-Dr 21-5101/Cr cash and leave the
      // creditBalance un-restored. The tag filter excludes it (and any
      // paysolutions-surplus-advance, which has no paymentId). The advance-consume 2B
      // JE also has no paymentId so it is already not matched.
      const matchedEntries = await tx.journalEntry.findMany({
        where: {
          AND: [
            { metadata: { path: ['paymentId'], equals: refund.paymentId } } as any,
            {
              OR: [
                { metadata: { path: ['tag'], equals: 'receipt' } } as any,
                { metadata: { path: ['tag'], equals: '2B' } } as any,
                // legacy credit-funded clears (applyCreditBalance credit-allocation JE)
                { metadata: { path: ['tag'], equals: 'credit-allocation' } } as any,
              ],
            },
            { status: 'POSTED' },
            { deletedAt: null },
          ],
        },
      });
      // Skip originals already reversed by a PRIOR void/refund cycle (their
      // status stays POSTED; only metadata.reversed flips) — otherwise the
      // reversal template throws "already reversed" and the whole refund
      // aborts. JS filter, not SQL: JSON-path equality on a missing key is
      // NULL in Postgres, so a SQL NOT(...) would drop never-reversed JEs too.
      const originalEntries = matchedEntries.filter((e) => (e.metadata as any)?.reversed !== true);

      // The reversal posts to the current period of the payment's company — guard it
      // open (companyId-aware: runs the Tier-1 AccountingPeriod check, not just Tier-2).
      // All receipt JEs of one payment share the same FINANCE company; use the first.
      await validatePeriodOpen(tx, now, originalEntries[0]?.companyId ?? undefined);

      // CAS: only flip APPROVED → PROCESSED if it is *still* APPROVED — closes the
      // TOCTOU gap between the pre-tx read and this write.
      const cas = await tx.refund.updateMany({
        where: {
          id: refundId,
          status: 'APPROVED',
          deletedAt: null,
          bankReversalLockedAt: null,
          bankReversalRef: null,
        },
        data: {
          status: 'PROCESSED',
          bankReversalRef: dto.bankReversalRef,
          bankReversalAt: now,
          bankReversalNotes: dto.notes,
          // T1-C8 — freeze bankReversalRef / bankReversalAt on first write.
          bankReversalLockedAt: now,
        },
      });
      if (cas.count !== 1) {
        throw new ConflictException('คำขอคืนเงินถูกเปลี่ยนสถานะโดยผู้อื่นแล้ว — กรุณาลองใหม่');
      }
      const updated = await tx.refund.findUnique({ where: { id: refundId } });

      // Reverse EVERY receipt JE of the payment in full (A.5a mirror). One reversal
      // JE per original; the audit log records the comma-joined list.
      let reversalEntryNo: string | null = null;
      if (originalEntries.length > 0) {
        const revNos: string[] = [];
        for (const originalEntry of originalEntries) {
          const rev = await this.receiptVoidReversalTemplate.voidReceipt(originalEntry.id, tx, {
            flow: 'refund-reversal',
          });
          revNos.push(rev.entryNo);
        }
        reversalEntryNo = revNos.join(',');
      } else {
        this.logger.warn(
          `[refund ${refundId}] no POSTED payment JE for payment ${refund.paymentId} — ` +
            `reverting payment without a reversal JE (legacy)`,
        );
      }

      // Restore the installment to its true unpaid state and void its receipt (the
      // booking was wrong). Planned-schedule fields (monthlyPrincipal/Interest/
      // Commission, amountDue) and lateFee describe the plan, not this reverted payment.
      await tx.payment.update({
        where: { id: refund.paymentId },
        data: { status: 'PENDING', amountPaid: 0, paidDate: null },
      });
      await tx.receipt.updateMany({
        where: { paymentId: refund.paymentId, isVoided: false, deletedAt: null },
        data: {
          isVoided: true,
          voidReason: `คืนเงิน (refund ${refundId})`,
          voidApprovedById: userId,
          voidApprovedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'REFUND_PROCESSED',
          entity: 'Refund',
          entityId: refundId,
          oldValue: { status: 'APPROVED' },
          newValue: {
            status: 'PROCESSED',
            bankReversalRef: dto.bankReversalRef,
            reversalEntryNo,
          },
        },
      });

      return updated;
    });
  }

  async markFailed(refundId: string, dto: MarkRefundFailedDto, userId: string, _userRole: string) {
    return this.financialTransaction(async (tx) => {
      const actor = await this.refundActor(tx, userId, true, true);
      const refund = await tx.refund.findUnique({ where: { id: refundId } });
      if (!refund || refund.deletedAt) throw new NotFoundException('ไม่พบคำขอคืนเงิน');
      await this.assertContractAccess(tx, actor, refund.contractId);
      if (refund.status !== 'APPROVED')
        throw new BadRequestException('บันทึกธนาคาร reverse ไม่สำเร็จได้เฉพาะคำขอสถานะ APPROVED');
      const cas = await tx.refund.updateMany({
        where: { id: refundId, status: 'APPROVED', deletedAt: null },
        data: { status: 'FAILED', failureReason: dto.failureReason },
      });
      if (cas.count !== 1)
        throw new ConflictException('คำขอคืนเงินถูกเปลี่ยนสถานะโดยผู้อื่นแล้ว — กรุณาโหลดใหม่');
      await tx.auditLog.create({
        data: {
          userId,
          action: 'REFUND_FAILED',
          entity: 'Refund',
          entityId: refundId,
          oldValue: { status: 'APPROVED' },
          newValue: { status: 'FAILED', failureReason: dto.failureReason },
        },
      });
      return tx.refund.findUnique({ where: { id: refundId } });
    });
  }

  async findAll(
    filters: { status?: string; contractId?: string; page?: number; limit?: number },
    userId: string,
  ) {
    const actor = await this.refundActor(this.prisma, userId);
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
    const where: Prisma.RefundWhereInput = {
      deletedAt: null,
      payment: { contract: {
        deletedAt: null,
        ...(!hasCrossBranchAccess(actor) ? { branchId: actor.branchId ?? '__unassigned__' } : {}),
      } },
    };
    if (filters.status) where.status = filters.status as Prisma.EnumRefundStatusFilter['equals'];
    if (filters.contractId) where.contractId = filters.contractId;

    const [data, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        include: {
          payment: { select: { id: true, installmentNo: true, amountPaid: true } },
          requestedBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          rejectedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.refund.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, userId: string) {
    const actor = await this.refundActor(this.prisma, userId);
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: {
        payment: true,
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        rejectedBy: { select: { id: true, name: true } },
      },
    });
    if (!refund || refund.deletedAt) throw new NotFoundException('ไม่พบคำขอคืนเงิน');
    await this.assertContractAccess(this.prisma, actor, refund.contractId);
    return refund;
  }

  /** Receipt.amount is cash. Payment.amountPaid may also contain non-cash debt relief. */
  private async refundableCash(
    tx: Prisma.TransactionClient,
    payment: { id: string; contractId: string; amountPaid: Prisma.Decimal },
  ) {
    await this.assertCashOnlyRefund(tx, payment.id);
    const receipts = await tx.receipt.findMany({
      where: { paymentId: payment.id, contractId: payment.contractId, receiptType: { in: [...INSTALLMENT_MONEY_RECEIPT_TYPES] } },
      select: { amount: true, isVoided: true, deletedAt: true, createdAt: true },
    });
    // Existing voided/deleted receipt history is authoritative too: zero active
    // receipts means zero refundable cash, not a fallback to settled debt.
    if (receipts.length === 0) return { amount: new Prisma.Decimal(payment.amountPaid), latestReceiptAt: null };
    const active = receipts.filter((receipt) => !receipt.isVoided && !receipt.deletedAt);
    return {
      amount: active.reduce((sum, receipt) => sum.plus(receipt.amount), new Prisma.Decimal(0)),
      latestReceiptAt: active.reduce<Date | null>((latest, receipt) => !latest || receipt.createdAt > latest ? receipt.createdAt : latest, null),
    };
  }

  /** Mixed-funding reversals require the receipt-void workflow, which restores balances. */
  private async assertCashOnlyRefund(tx: Prisma.TransactionClient, paymentId: string) {
    const entries = await tx.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['paymentId'], equals: paymentId } },
          { OR: [
            { metadata: { path: ['tag'], equals: 'receipt' } },
            { metadata: { path: ['tag'], equals: '2B' } },
            { metadata: { path: ['tag'], equals: 'credit-allocation' } },
          ] },
          { status: 'POSTED' },
          { deletedAt: null },
        ],
      },
      select: {
        metadata: true,
        lines: {
          where: { deletedAt: null, accountCode: { in: ['21-1103', '21-5101'] } },
          select: { debit: true, credit: true },
        },
      },
    });
    if (entries.some((entry) =>
      (entry.metadata as Prisma.JsonObject | null)?.reversed !== true &&
      entry.lines.some((line) => !line.debit.isZero() || !line.credit.isZero()),
    )) {
      throw new BadRequestException(
        'งวดนี้มีเงินรับล่วงหน้าหรือเครดิตลูกค้าร่วมด้วย — กรุณาส่งคำขอยกเลิกใบเสร็จให้ผู้มีสิทธิอนุมัติแทน เพื่อคืนยอดเงินรับล่วงหน้าและเครดิตให้ถูกต้อง',
      );
    }
  }

  private async assertCurrentRefundAmount(
    tx: Prisma.TransactionClient,
    refund: { paymentId: string; contractId: string; amount: Prisma.Decimal; requestedAt: Date },
  ) {
    const payment = await tx.payment.findUnique({
      where: { id: refund.paymentId },
      select: { id: true, contractId: true, amountPaid: true, deletedAt: true, status: true },
    });
    if (!payment || payment.deletedAt) throw new NotFoundException('ไม่พบรายการชำระเงินของคำขอคืนเงิน');
    if (payment.contractId !== refund.contractId || !['PAID', 'PARTIALLY_PAID'].includes(payment.status)) {
      throw new ConflictException('รายการชำระเงินเปลี่ยนแล้ว — กรุณาส่งคำขอคืนเงินใหม่');
    }
    const current = await this.refundableCash(tx, payment);
    if (current.amount.lte(0) || !current.amount.equals(refund.amount)) {
      throw new BadRequestException('ยอดคืนต้องเท่ากับเงินที่รับจริงตามใบเสร็จของงวด — กรุณาส่งคำขอคืนเงินใหม่');
    }
    if (current.latestReceiptAt && current.latestReceiptAt > refund.requestedAt) {
      throw new ConflictException('มีใบเสร็จใหม่หลังส่งคำขอคืนเงิน — กรุณาส่งคำขอใหม่');
    }
  }

  private async refundActor(
    tx: Prisma.TransactionClient,
    userId: string,
    requiresApproval = false,
    bankConfirmation = false,
  ): Promise<ResolvedPaymentApprovalPermissions['user']> {
    const resolved = requiresApproval
      ? await assertPaymentApprovalPermission(tx, userId, 'REFUND')
      : await getPaymentApprovalPermissions(tx, userId);
    if (!PAYMENT_APPROVAL_USER_ROLES.includes(resolved.user.role)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ทำรายการคืนเงิน');
    }
    if (bankConfirmation && !RefundsService.APPROVER_ROLES.includes(resolved.user.role)) {
      throw new ForbiddenException('สิทธิ์บันทึกผล bank reversal เฉพาะ OWNER / FINANCE_MANAGER');
    }
    return resolved.user;
  }

  private async assertContractAccess(
    tx: Prisma.TransactionClient,
    actor: ResolvedPaymentApprovalPermissions['user'],
    contractId: string,
  ) {
    const contract = await tx.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { branchId: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญาของคำขอคืนเงิน');
    if (!hasCrossBranchAccess(actor) && (!actor.branchId || actor.branchId !== contract.branchId)) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงคำขอคืนเงินต่างสาขา');
    }
  }

  private async financialTransaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('ข้อมูลคืนเงินเปลี่ยนระหว่างทำรายการ — กรุณาโหลดใหม่');
      }
      throw error;
    }
  }
}
