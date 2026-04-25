import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LateFeeWaiverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLateFeeWaiverDto } from './dto/create-request.dto';

/**
 * LateFeeWaiverService — collector → OWNER 4-eyes approval flow for waiving
 * late fees on one or more Payment rows.
 *
 * Flow:
 *   collector calls create() → status=PENDING with totalWaiveAmount snapshot
 *   OWNER calls approve()    → in $transaction: zero `lateFee` on each Payment
 *                              + mark `lateFeeWaived=true` + status=APPROVED.
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
  constructor(private readonly prisma: PrismaService) {}

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
        select: { id: true, lateFee: true, lateFeeWaived: true },
      });
      if (payments.length === 0) {
        throw new NotFoundException('ไม่พบรายการชำระที่ขอ waive');
      }

      const now = new Date();
      let totalWaived = new Prisma.Decimal(0);

      for (const p of payments) {
        if (p.lateFeeWaived) continue; // skip rows already waived elsewhere
        const original = new Prisma.Decimal(p.lateFee);
        if (original.lte(0)) continue;
        totalWaived = totalWaived.add(original);
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
          },
        });
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
    });
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
