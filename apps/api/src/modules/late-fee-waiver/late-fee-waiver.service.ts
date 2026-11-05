import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LateFeeWaiverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import {
  checkContractCompletion,
  lateFeeWaiverSettlement,
} from '../payments/services/payment-helpers';
import { CreateLateFeeWaiverDto } from './dto/create-request.dto';

/**
 * LateFeeWaiverService — collector → OWNER 4-eyes approval flow for waiving
 * late fees on one or more Payment rows.
 *
 * Flow:
 *   collector calls create() → status=PENDING with totalWaiveAmount snapshot
 *   OWNER calls approve()    → in $transaction: zero `lateFee` on each Payment
 *                              + mark `lateFeeWaived=true` (+ PAID when the base
 *                              is already paid) + status=APPROVED.
 *                              Approver MUST differ from requester (SoD).
 *   OWNER calls reject()     → status=REJECTED + rejectedReason. No mutation
 *                              of Payment rows.
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
  private readonly logger = new Logger(LateFeeWaiverService.name);

  constructor(
    private readonly prisma: PrismaService,
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
    // what the collector saw. Only PENDING / OVERDUE / PARTIALLY_PAID
    // payments with non-zero lateFee qualify — already waived rows or fully
    // paid rows can't be re-waived.
    const payments = await this.prisma.payment.findMany({
      where: {
        id: { in: dto.paymentIds },
        contractId: dto.contractId,
        deletedAt: null,
        lateFeeWaived: false,
      },
      select: { id: true, lateFee: true, status: true },
    });

    if (payments.length !== dto.paymentIds.length) {
      throw new BadRequestException(
        'พบงวดบางรายการที่ยกเว้นค่าปรับไปแล้ว หรือไม่อยู่ในสัญญานี้',
      );
    }

    const totalWaiveAmount = payments.reduce(
      (sum, p) => sum.add(p.lateFee),
      new Prisma.Decimal(0),
    );
    if (totalWaiveAmount.lte(0)) {
      throw new BadRequestException('งวดที่เลือกไม่มีค่าปรับให้ยกเว้น');
    }

    return this.prisma.lateFeeWaiverRequest.create({
      data: {
        contractId: dto.contractId,
        paymentIds: dto.paymentIds,
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
   * OWNER approves: zero `lateFee` on each Payment row inside a single
   * transaction (so partial failure rolls back), audit who/when on the
   * request row, and persist per-payment waiver evidence (waivedById /
   * waivedReason / waivedAmount) so existing reports keep working.
   *
   * Segregation of Duties: approver must differ from requester. Without
   * SoD the workflow degenerates into single-user write-down which our
   * margin can't sustain.
   *
   * An installment whose base is already paid (amountPaid ≥ amountDue — only the
   * fee was outstanding, e.g. PARTIALLY_PAID) becomes PAID with paidDate, and the
   * contract-completion check runs in the same tx — the same rule and the same
   * side effect as the payments-side waiver (`lateFeeWaiverSettlement` +
   * `checkContractCompletion`, Serializable like that path). Before this a
   * fee-only installment was left PARTIALLY_PAID with nothing owed.
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

    return this.prisma.$transaction(async (tx) => {
      const payments = await tx.payment.findMany({
        where: { id: { in: request.paymentIds }, deletedAt: null },
        select: {
          id: true,
          contractId: true,
          lateFee: true,
          lateFeeWaived: true,
          amountDue: true,
          amountPaid: true,
          status: true,
        },
      });
      if (payments.length === 0) {
        throw new NotFoundException('ไม่พบรายการชำระที่ขอ waive');
      }

      const now = new Date();
      let totalWaived = new Prisma.Decimal(0);
      const settledContractIds = new Set<string>();

      for (const p of payments) {
        if (p.lateFeeWaived) continue; // skip rows already waived elsewhere
        const original = new Prisma.Decimal(p.lateFee);
        if (original.lte(0)) continue;
        totalWaived = totalWaived.add(original);
        const settlement = lateFeeWaiverSettlement(p, now);
        if (settlement.becomesPaid) settledContractIds.add(p.contractId);
        await tx.payment.update({
          where: { id: p.id },
          data: {
            lateFee: 0,
            lateFeeWaived: true,
            waivedById: request.requesterUserId,
            waivedAt: now,
            waivedReason: request.reason,
            waivedApprovedById: approverUserId,
            waivedAmount: original,
            ...settlement.update,
          },
        });
      }

      // Same tx as the PAID flips — completion (COMPLETED + call-log tier + ownership
      // release) cannot diverge from the installment status.
      for (const contractId of settledContractIds) {
        await checkContractCompletion(
          this.prisma,
          this.productsService,
          this.logger,
          contractId,
          tx,
        );
      }

      // TODO journal adjust — discuss accountant
      // Late fees are currently cash-basis (booked to 42-1102 only when the
      // payment hits the bank). A waiver before payment has no income to
      // reverse. If we shift to accrual recognition, post:
      //   Dr. 42-1102 Late Fee Income   [totalWaived]
      //     Cr. 11-2102 HP Receivable    [totalWaived]
      // Until then, this comment is the contract with finance — touch it
      // when the recognition policy changes.

      return tx.lateFeeWaiverRequest.update({
        where: { id },
        data: {
          status: LateFeeWaiverStatus.APPROVED,
          approverUserId,
          approvedAt: now,
          totalWaiveAmount: totalWaived,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
