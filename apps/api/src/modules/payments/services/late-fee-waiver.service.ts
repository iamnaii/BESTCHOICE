import { consumePaymentApproval, type PaymentApprovalContext } from './payment-approval-request.util';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { StructuredLoggerService } from '../../../common/logger';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ProductsService } from '../../products/products.service';
import { checkContractCompletion } from './payment-helpers';

/**
 * Late-fee waiver flow — its OWN $transaction (4-eyes Segregation-of-Duties +
 * FeeWaiverApproval immutable evidence + PARTIALLY_PAID→PAID transition +
 * checkContractCompletion). NO journal entry is posted (a waiver writes down a
 * fee, it does not move money). Large-waiver (>5,000฿) Sentry alarm fires after
 * the tx. Body moved VERBATIM from the legacy PaymentsService.
 *
 * Constructed internally by PaymentsService.
 */
@Injectable()
export class LateFeeWaiverService {
  private readonly structuredLogger = new StructuredLoggerService('PaymentsService');
  private readonly logger = new Logger('PaymentsService');

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private productsService: ProductsService,
  ) {}

  // ─── Waive late fee (wrapped in transaction to prevent race condition) ─
  async waiveLateFee(
    paymentId: string,
    reason: string,
    userId: string,
    approverId: string,
    context?: { ipAddress?: string | null; userAgent?: string | null },
    approvalContext?: PaymentApprovalContext,
  ) {
    if (!approvalContext) {
      throw new ForbiddenException('กรุณาส่งคำขออนุโลมค่าปรับผ่านหน้ารออนุมัติ');
    }
    if (!reason?.trim()) throw new BadRequestException('กรุณาระบุเหตุผลที่อนุโลมค่าปรับ');
    approverId = approvalContext.actorId;

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.deletedAt) throw new NotFoundException('ไม่พบรายการชำระ');
      const approval = await consumePaymentApproval(tx, approvalContext, 'WAIVE_LATE_FEE', paymentId);
      if (approval.requestedById !== userId) throw new ForbiddenException('ผู้ขออนุมัติไม่ตรงกับผู้ทำรายการ');
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
        await checkContractCompletion(this.prisma, this.productsService, this.logger, payment.contractId, tx);
      }

      return { updated, originalLateFee, isNowFullyPaid, contractId: payment.contractId, installmentNo: payment.installmentNo };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

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
}
