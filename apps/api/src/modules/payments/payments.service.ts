import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: { role: string; branchId: string | null }, query: { status?: string; search?: string; contractId?: string }) {
    const where: any = {};

    if (query.contractId) {
      where.contractId = query.contractId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.contract = {
        OR: [
          { contractNumber: { contains: query.search, mode: 'insensitive' } },
          { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      };
    }

    if (user.role !== 'OWNER' && user.role !== 'ACCOUNTANT' && user.branchId) {
      where.contract = { ...where.contract, branchId: user.branchId };
    }

    return this.prisma.payment.findMany({
      where,
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: { select: { id: true, name: true, phone: true } },
            product: { select: { id: true, name: true, brand: true, model: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ dueDate: 'asc' }],
    });
  }

  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            customer: true,
            product: { select: { id: true, name: true, brand: true, model: true } },
          },
        },
        recordedBy: { select: { id: true, name: true } },
      },
    });
    if (!payment) throw new NotFoundException('ไม่พบข้อมูลการชำระ');
    return payment;
  }

  async recordPayment(paymentId: string, dto: RecordPaymentDto, userId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { contract: true },
    });
    if (!payment) throw new NotFoundException('ไม่พบงวดที่ต้องชำระ');
    if (payment.status === 'PAID') {
      throw new BadRequestException('งวดนี้ชำระแล้ว');
    }

    const amountDue = Number(payment.amountDue);
    const newStatus = dto.amountPaid >= amountDue ? 'PAID' : 'PARTIALLY_PAID';

    // Calculate late fee
    let lateFee = 0;
    const now = new Date();
    if (now > payment.dueDate) {
      const diffDays = Math.floor((now.getTime() - payment.dueDate.getTime()) / (1000 * 60 * 60 * 24));
      const feePerDay = 100; // default from system config
      const feeCap = 200;
      lateFee = Math.min(diffDays * feePerDay, feeCap);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          amountPaid: dto.amountPaid,
          paidDate: new Date(),
          paymentMethod: dto.paymentMethod as any,
          status: newStatus as any,
          lateFee,
          evidenceUrl: dto.evidenceUrl,
          notes: dto.notes,
          recordedById: userId,
        },
        include: {
          contract: {
            select: {
              id: true,
              contractNumber: true,
              customer: { select: { name: true } },
            },
          },
        },
      });

      // Check if all payments are completed → update contract status
      if (newStatus === 'PAID') {
        const pendingPayments = await tx.payment.count({
          where: {
            contractId: payment.contractId,
            status: { not: 'PAID' },
            id: { not: paymentId },
          },
        });

        if (pendingPayments === 0) {
          await tx.contract.update({
            where: { id: payment.contractId },
            data: { status: 'COMPLETED' },
          });
        }
      }

      return updated;
    });
  }
}
