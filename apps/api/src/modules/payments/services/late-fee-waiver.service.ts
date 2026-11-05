import { consumePaymentApproval, type PaymentApprovalContext } from './payment-approval-request.util';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { StructuredLoggerService } from '../../../common/logger';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ProductsService } from '../../products/products.service';
import { checkContractCompletion } from './payment-helpers';
import {
  alarmIfLargeLateFeeWaiver,
  applyLateFeeWaiverInTx,
  lateFeeWaivedAuditDetails,
  loadWaiverSettlements,
  waiverSettlesInstallment,
} from './late-fee-waiver-settlement.util';

/**
 * Late-fee waiver flow — its OWN $transaction (4-eyes Segregation-of-Duties +
 * FeeWaiverApproval immutable evidence + PARTIALLY_PAID→PAID transition +
 * checkContractCompletion). NO journal entry is posted (a waiver writes down a
 * fee, it does not move money). Large-waiver (>5,000฿) Sentry alarm fires after
 * the tx.
 *
 * GL-aware (late-fee-waiver-settlement.util.ts): only the fee the ledger has NOT
 * collected is waivable, and the installment becomes PAID only when its
 * principal (amountPaid − fee collected) covers amountDue. The same rules run in
 * the collector-request path (late-fee-waiver module).
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
      const originalLateFee = new Prisma.Decimal(payment.lateFee.toString());
      if (originalLateFee.lte(0)) throw new BadRequestException('รายการนี้ไม่มีค่าปรับ');

      const settlement = (await loadWaiverSettlements(tx, [payment])).get(payment.id)!;
      if (settlement.waivableFee.lte(0)) {
        throw new BadRequestException(
          'ค่าปรับของงวดนี้รับชำระครบแล้ว ไม่มียอดให้ยกเว้น — ยอดที่ค้างเป็นค่างวด ให้รับชำระตามปกติ',
        );
      }

      // Contract status only matters when the principal is settled (the
      // settlement gate); skip the read otherwise.
      const contract =
        settlement.principalSettled && payment.status !== 'PAID'
          ? await tx.contract.findUnique({
              where: { id: payment.contractId },
              select: { status: true },
            })
          : null;
      const settles = waiverSettlesInstallment(settlement, payment.status, contract?.status);

      const updated = await applyLateFeeWaiverInTx(tx, {
        payment,
        settlement,
        settles,
        waivedById: userId,
        approverId,
        reason,
        waivedAt: new Date(),
        evidence: context,
      });

      if (settles) {
        await checkContractCompletion(this.prisma, this.productsService, this.logger, payment.contractId, tx);
      }

      return {
        updated,
        originalLateFee,
        settlement,
        isNowFullyPaid: settles,
        contractId: payment.contractId,
        installmentNo: payment.installmentNo,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const waivedAmount = result.settlement.waivableFee.toDecimalPlaces(2);

    // Structured log for late fee waiver observability
    this.structuredLogger.log('payment.lateFeeWaived', {
      paymentId,
      contractId: result.contractId,
      installmentNo: result.installmentNo,
      originalLateFee: result.originalLateFee.toDecimalPlaces(2).toNumber(),
      waivedAmount: waivedAmount.toNumber(),
      feePaid: result.settlement.feePaid.toDecimalPlaces(2).toNumber(),
      becameFullyPaid: result.isNowFullyPaid,
      reason,
      userId,
      approverId,
    });

    // T1-C9 — unusual-waiver alarm on the amount actually written down.
    alarmIfLargeLateFeeWaiver(waivedAmount, {
      waivedBy: userId,
      contractId: result.contractId,
      paymentId,
      approverId,
    });

    // Financial audit trail (outside transaction — audit failure shouldn't roll back waiver)
    await this.auditService.logPaymentEvent({
      userId,
      contractId: result.contractId,
      paymentId,
      action: 'LATE_FEE_WAIVED',
      amount: waivedAmount.toNumber(),
      installmentNo: result.installmentNo,
      details: lateFeeWaivedAuditDetails(
        result.settlement,
        result.originalLateFee,
        result.isNowFullyPaid,
        { reason, approverId },
      ),
    });

    return {
      ...result.updated,
      originalLateFee: result.originalLateFee.toDecimalPlaces(2).toNumber(),
    };
  }
}
