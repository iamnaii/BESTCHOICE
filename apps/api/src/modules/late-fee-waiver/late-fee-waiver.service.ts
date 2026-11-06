import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LateFeeWaiverStatus, Prisma } from '@prisma/client';
import { StructuredLoggerService } from '../../common/logger';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProductsService } from '../products/products.service';
import { checkContractCompletion } from '../payments/services/payment-helpers';
import {
  alarmIfLargeLateFeeWaiver,
  applyLateFeeWaiverInTx,
  lateFeeWaivedAuditDetails,
  loadWaiverSettlements,
  waiverSettlesInstallment,
  type WaiverSettlement,
} from '../payments/services/late-fee-waiver-settlement.util';
import { CreateLateFeeWaiverDto } from './dto/create-request.dto';

/**
 * LateFeeWaiverService — collector → OWNER 4-eyes approval flow for waiving
 * late fees on one or more Payment rows.
 *
 * Flow:
 *   collector calls create() → status=PENDING with totalWaiveAmount snapshot
 *   OWNER calls approve()    → in one Serializable $transaction: waive the fee
 *                              the ledger has NOT collected on each Payment,
 *                              settle (PAID + checkContractCompletion) only rows
 *                              whose principal is covered, status=APPROVED.
 *                              Approver MUST differ from requester (SoD).
 *   OWNER calls reject()     → status=REJECTED + rejectedReason. No mutation
 *                              of Payment rows.
 *
 * Settlement rules are shared with the payment-approval waiver
 * (payments/services/late-fee-waiver-settlement.util.ts) — receipts allocate
 * fee first, so Payment.amountPaid is never read as principal on its own.
 *
 * Journal impact (Dr. Late Fee Income / Cr. HP Receivable for the waived
 * amount) is intentionally NOT auto-posted yet — see TODO inside approve()
 * for the open accountant question. Late fees are recognized cash-basis
 * today (recorded as Late Fee Income only when the payment lands), so a
 * waiver before payment has no income to reverse. Once we move toward
 * accrual recognition (post-N-005 review), this service is the right place
 * to emit the reversing entry.
 */
@Injectable()
export class LateFeeWaiverService {
  private readonly structuredLogger = new StructuredLoggerService('LateFeeWaiverService');
  private readonly logger = new Logger('LateFeeWaiverService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly productsService: ProductsService,
  ) {}

  async create(dto: CreateLateFeeWaiverDto, requesterUserId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: dto.contractId, deletedAt: null },
      select: { id: true },
    });
    if (!contract) {
      throw new NotFoundException('ไม่พบสัญญานี้');
    }

    // Snapshot the late fees at request time so the OWNER reviews exactly
    // what is waivable. Every listed id must be a live, not-yet-waived row of
    // this contract (else the request is refused). Among those, only PENDING /
    // OVERDUE / PARTIALLY_PAID rows with fee the ledger has not collected
    // qualify — fully paid rows and rows whose fee was already paid are
    // skipped (the collector dialog's "select all" lists them too).
    const payments = await this.prisma.payment.findMany({
      where: {
        id: { in: dto.paymentIds },
        contractId: dto.contractId,
        deletedAt: null,
        lateFeeWaived: false,
      },
      select: {
        id: true,
        status: true,
        amountDue: true,
        amountPaid: true,
        lateFee: true,
      },
    });

    if (payments.length !== dto.paymentIds.length) {
      throw new BadRequestException(
        'พบงวดบางรายการที่ยกเว้นค่าปรับไปแล้ว หรือไม่อยู่ในสัญญานี้',
      );
    }

    const unpaid = payments.filter((p) => p.status !== 'PAID');
    const settlements = await loadWaiverSettlements(this.prisma, unpaid);
    const qualifying = unpaid.filter((p) => settlements.get(p.id)!.waivableFee.gt(0));
    const totalWaiveAmount = qualifying.reduce(
      (sum, p) => sum.add(settlements.get(p.id)!.waivableFee),
      new Prisma.Decimal(0),
    );
    if (totalWaiveAmount.lte(0)) {
      throw new BadRequestException('งวดที่เลือกไม่มีค่าปรับค้างให้ยกเว้น');
    }

    return this.prisma.lateFeeWaiverRequest.create({
      data: {
        contractId: dto.contractId,
        paymentIds: qualifying.map((p) => p.id),
        reason: dto.reason,
        totalWaiveAmount,
        requesterUserId,
        status: LateFeeWaiverStatus.PENDING,
      },
    });
  }

  async list(status?: LateFeeWaiverStatus) {
    return this.prisma.lateFeeWaiverRequest.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: { select: { id: true, name: true, phone: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        requester: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * OWNER approves: inside one Serializable transaction, waive the fee the
   * ledger has not collected on each listed Payment (lateFee keeps the
   * collected part, waivedAmount = the remainder), record FeeWaiverApproval
   * evidence, settle rows whose principal is covered (PAID + paidDate) and run
   * checkContractCompletion, then flip the request to APPROVED with the
   * amount actually waived.
   *
   * Segregation of Duties: approver must differ from requester. Without
   * SoD the workflow degenerates into single-user write-down which our
   * margin can't sustain.
   */
  async approve(id: string, approverUserId: string) {
    const request = await this.prisma.lateFeeWaiverRequest.findFirst({
      where: { id, deletedAt: null },
    });
    if (!request) throw new NotFoundException('ไม่พบคำขอ waive ค่าปรับนี้');
    if (request.status !== LateFeeWaiverStatus.PENDING) {
      throw new BadRequestException('คำขอนี้ถูกอนุมัติหรือปฏิเสธไปแล้ว');
    }
    if (request.requesterUserId === approverUserId) {
      throw new ForbiddenException(
        'ผู้ขอและผู้อนุมัติต้องเป็นคนละคน (Segregation of Duties)',
      );
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Re-check inside the transaction: two approvals of the same request
        // must not both waive (Serializable turns the race into a conflict).
        const current = await tx.lateFeeWaiverRequest.findFirst({
          where: { id, deletedAt: null },
          select: { status: true },
        });
        if (current?.status !== LateFeeWaiverStatus.PENDING) {
          throw new BadRequestException('คำขอนี้ถูกอนุมัติหรือปฏิเสธไปแล้ว');
        }

        const payments = await tx.payment.findMany({
          where: { id: { in: request.paymentIds }, contractId: request.contractId, deletedAt: null },
        });
        if (payments.length === 0) {
          throw new NotFoundException('ไม่พบรายการชำระที่ขอ waive');
        }

        // Same eligibility as create(), re-evaluated at approval time: a row
        // may have been paid (or its fee collected) since the request.
        const eligible = payments.filter(
          (p) => !p.lateFeeWaived && p.status !== 'PAID' && new Prisma.Decimal(p.lateFee).gt(0),
        );
        const settlements = await loadWaiverSettlements(tx, eligible);
        const contract = await tx.contract.findFirst({
          where: { id: request.contractId },
          select: { status: true },
        });

        const now = new Date();
        let totalWaived = new Prisma.Decimal(0);
        let anySettled = false;
        const waived: Array<{
          paymentId: string;
          installmentNo: number;
          originalLateFee: Prisma.Decimal;
          settlement: WaiverSettlement;
          settles: boolean;
        }> = [];

        for (const p of eligible) {
          const settlement = settlements.get(p.id)!;
          if (settlement.waivableFee.lte(0)) continue; // fee already collected
          const settles = waiverSettlesInstallment(settlement, p.status, contract?.status);
          await applyLateFeeWaiverInTx(tx, {
            payment: p,
            settlement,
            settles,
            waivedById: request.requesterUserId,
            approverId: approverUserId,
            reason: request.reason,
            waivedAt: now,
          });
          totalWaived = totalWaived.add(settlement.waivableFee);
          anySettled = anySettled || settles;
          waived.push({
            paymentId: p.id,
            installmentNo: p.installmentNo,
            originalLateFee: new Prisma.Decimal(p.lateFee),
            settlement,
            settles,
          });
        }

        if (anySettled) {
          await checkContractCompletion(
            this.prisma,
            this.productsService,
            this.logger,
            request.contractId,
            tx,
          );
        }

        // TODO journal adjust — discuss accountant
        // Late fees are currently cash-basis (booked to 42-1103 only when the
        // payment hits the bank). The waived portion is, by construction, the
        // part the ledger never collected — no income to reverse. If we shift
        // to accrual recognition, post:
        //   Dr. 42-1103 Late Fee Income            [totalWaived]
        //     Cr. <late-fee receivable — not in the chart yet> [totalWaived]
        // Until then, this comment is the contract with finance — touch it
        // when the recognition policy changes.

        const updated = await tx.lateFeeWaiverRequest.update({
          where: { id },
          data: {
            status: LateFeeWaiverStatus.APPROVED,
            approverUserId,
            approvedAt: now,
            totalWaiveAmount: totalWaived,
          },
        });
        return { updated, waived, totalWaived };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Post-commit side effects — same shape as the payment-approval waiver.
    for (const w of result.waived) {
      const waivedAmount = w.settlement.waivableFee.toDecimalPlaces(2);
      this.structuredLogger.log('payment.lateFeeWaived', {
        paymentId: w.paymentId,
        contractId: request.contractId,
        installmentNo: w.installmentNo,
        originalLateFee: w.originalLateFee.toDecimalPlaces(2).toNumber(),
        waivedAmount: waivedAmount.toNumber(),
        feePaid: w.settlement.feePaid.toDecimalPlaces(2).toNumber(),
        becameFullyPaid: w.settles,
        reason: request.reason,
        userId: request.requesterUserId,
        approverId: approverUserId,
        waiverRequestId: id,
      });
      await this.auditService.logPaymentEvent({
        userId: request.requesterUserId,
        contractId: request.contractId,
        paymentId: w.paymentId,
        action: 'LATE_FEE_WAIVED',
        amount: waivedAmount.toNumber(),
        installmentNo: w.installmentNo,
        details: lateFeeWaivedAuditDetails(w.settlement, w.originalLateFee, w.settles, {
          reason: request.reason,
          approverId: approverUserId,
          waiverRequestId: id,
        }),
      });
    }
    // One approval decision → one alarm on the total written down.
    alarmIfLargeLateFeeWaiver(result.totalWaived, {
      waivedBy: request.requesterUserId,
      contractId: request.contractId,
      approverId: approverUserId,
      waiverRequestId: id,
      paymentIds: result.waived.map((w) => w.paymentId),
    });

    return result.updated;
  }

  async reject(id: string, approverUserId: string, reason: string) {
    const request = await this.prisma.lateFeeWaiverRequest.findFirst({
      where: { id, deletedAt: null },
    });
    if (!request) throw new NotFoundException('ไม่พบคำขอ waive ค่าปรับนี้');
    if (request.status !== LateFeeWaiverStatus.PENDING) {
      throw new BadRequestException('คำขอนี้ถูกอนุมัติหรือปฏิเสธไปแล้ว');
    }

    return this.prisma.lateFeeWaiverRequest.update({
      where: { id },
      data: {
        status: LateFeeWaiverStatus.REJECTED,
        approverUserId,
        approvedAt: new Date(),
        rejectedReason: reason,
      },
    });
  }
}
