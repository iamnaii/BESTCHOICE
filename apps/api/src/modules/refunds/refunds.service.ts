import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
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
 * Approval roles: OWNER or FINANCE_MANAGER.
 * SoD: approver ≠ requester (cannot self-approve).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);
  static readonly APPROVER_ROLES = ['OWNER', 'FINANCE_MANAGER'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async requestRefund(dto: RequestRefundDto, userId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: dto.paymentId },
      include: { refunds: { where: { deletedAt: null } } },
    });
    if (!payment || payment.deletedAt) {
      throw new NotFoundException('ไม่พบรายการชำระเงิน');
    }
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
    const remaining = new Prisma.Decimal(payment.amountPaid).minus(alreadyRefunded);
    if (new Prisma.Decimal(dto.amount).gt(remaining)) {
      throw new BadRequestException(
        `จำนวนเงินคืน (${dto.amount.toLocaleString()}) เกินยอดคงเหลือที่คืนได้ ` +
          `(${remaining.toFixed(2)} บาท)`,
      );
    }

    const refund = await this.prisma.refund.create({
      data: {
        paymentId: payment.id,
        contractId: payment.contractId,
        amount: new Prisma.Decimal(dto.amount),
        reason: dto.reason,
        status: 'REQUESTED',
        requestedById: userId,
      },
    });

    await this.audit.log({
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
    });

    return refund;
  }

  async approveRefund(refundId: string, userId: string, userRole: string) {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund || refund.deletedAt) throw new NotFoundException('ไม่พบคำขอคืนเงิน');
    if (refund.status !== 'REQUESTED') {
      throw new BadRequestException(
        `อนุมัติได้เฉพาะคำขอสถานะ REQUESTED (สถานะปัจจุบัน: ${refund.status})`,
      );
    }
    if (!RefundsService.APPROVER_ROLES.includes(userRole)) {
      throw new ForbiddenException(
        `ผู้อนุมัติต้องเป็น ${RefundsService.APPROVER_ROLES.join(' / ')} เท่านั้น`,
      );
    }
    if (refund.requestedById === userId) {
      throw new ForbiddenException(
        'ผู้อนุมัติต้องไม่ใช่ผู้ขอคืนเงิน (Segregation of Duties)',
      );
    }

    const updated = await this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
      },
    });

    await this.audit.log({
      userId,
      action: 'REFUND_APPROVED',
      entity: 'Refund',
      entityId: refundId,
      oldValue: { status: 'REQUESTED' },
      newValue: { status: 'APPROVED', approvedById: userId },
    });

    return updated;
  }

  async rejectRefund(refundId: string, dto: RejectRefundDto, userId: string, userRole: string) {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund || refund.deletedAt) throw new NotFoundException('ไม่พบคำขอคืนเงิน');
    if (refund.status !== 'REQUESTED') {
      throw new BadRequestException(
        `ปฏิเสธได้เฉพาะคำขอสถานะ REQUESTED (สถานะปัจจุบัน: ${refund.status})`,
      );
    }
    if (!RefundsService.APPROVER_ROLES.includes(userRole)) {
      throw new ForbiddenException(
        `ผู้ปฏิเสธต้องเป็น ${RefundsService.APPROVER_ROLES.join(' / ')} เท่านั้น`,
      );
    }
    if (refund.requestedById === userId) {
      throw new ForbiddenException('ผู้ปฏิเสธต้องไม่ใช่ผู้ขอคืนเงิน');
    }

    const updated = await this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'REJECTED',
        rejectedById: userId,
        rejectedAt: new Date(),
        rejectedReason: dto.reason,
      },
    });

    await this.audit.log({
      userId,
      action: 'REFUND_REJECTED',
      entity: 'Refund',
      entityId: refundId,
      oldValue: { status: 'REQUESTED' },
      newValue: { status: 'REJECTED', rejectedReason: dto.reason },
    });

    return updated;
  }

  /** Called after staff manually confirms with the bank that reversal went through. */
  async markReversed(refundId: string, dto: MarkRefundReversedDto, userId: string, userRole: string) {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund || refund.deletedAt) throw new NotFoundException('ไม่พบคำขอคืนเงิน');
    if (refund.status !== 'APPROVED') {
      throw new BadRequestException(
        `บันทึกว่าธนาคาร reverse สำเร็จได้เฉพาะคำขอสถานะ APPROVED ` +
          `(สถานะปัจจุบัน: ${refund.status})`,
      );
    }
    if (!RefundsService.APPROVER_ROLES.includes(userRole)) {
      throw new ForbiddenException(
        `สิทธิ์บันทึก bank reversal เฉพาะ ${RefundsService.APPROVER_ROLES.join(' / ')}`,
      );
    }

    const updated = await this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'PROCESSED',
        bankReversalRef: dto.bankReversalRef,
        bankReversalAt: new Date(),
        bankReversalNotes: dto.notes,
      },
    });

    await this.audit.log({
      userId,
      action: 'REFUND_PROCESSED',
      entity: 'Refund',
      entityId: refundId,
      oldValue: { status: 'APPROVED' },
      newValue: {
        status: 'PROCESSED',
        bankReversalRef: dto.bankReversalRef,
      },
    });

    return updated;
  }

  async markFailed(refundId: string, dto: MarkRefundFailedDto, userId: string, userRole: string) {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund || refund.deletedAt) throw new NotFoundException('ไม่พบคำขอคืนเงิน');
    if (refund.status !== 'APPROVED') {
      throw new BadRequestException(
        `บันทึกว่าธนาคาร reverse ไม่สำเร็จได้เฉพาะคำขอสถานะ APPROVED ` +
          `(สถานะปัจจุบัน: ${refund.status})`,
      );
    }
    if (!RefundsService.APPROVER_ROLES.includes(userRole)) {
      throw new ForbiddenException(
        `สิทธิ์บันทึก bank reversal failure เฉพาะ ${RefundsService.APPROVER_ROLES.join(' / ')}`,
      );
    }

    const updated = await this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'FAILED',
        failureReason: dto.failureReason,
      },
    });

    await this.audit.log({
      userId,
      action: 'REFUND_FAILED',
      entity: 'Refund',
      entityId: refundId,
      oldValue: { status: 'APPROVED' },
      newValue: { status: 'FAILED', failureReason: dto.failureReason },
    });

    return updated;
  }

  async findAll(filters: { status?: string; contractId?: string; page?: number; limit?: number }) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
    const where: Prisma.RefundWhereInput = { deletedAt: null };
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

  async findOne(id: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id },
      include: {
        payment: true,
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        rejectedBy: { select: { id: true, name: true } },
      },
    });
    if (!refund) throw new NotFoundException('ไม่พบคำขอคืนเงิน');
    return refund;
  }
}
