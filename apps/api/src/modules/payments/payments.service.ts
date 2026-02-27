import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  // ─── Record a single payment ─────────────────────────
  async recordPayment(
    contractId: string,
    installmentNo: number,
    amount: number,
    paymentMethod: string,
    recordedById: string,
    evidenceUrl?: string,
    notes?: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { contractId, installmentNo },
    });
    if (!payment) throw new NotFoundException('ไม่พบงวดที่ต้องการ');
    if (payment.status === 'PAID') throw new BadRequestException('งวดนี้ชำระแล้ว');

    const amountDue = Number(payment.amountDue) + Number(payment.lateFee);
    const prevPaid = Number(payment.amountPaid);
    const totalPaid = prevPaid + amount;

    const isPaidInFull = totalPaid >= amountDue;

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        amountPaid: totalPaid,
        paidDate: isPaidInFull ? new Date() : null,
        paymentMethod: paymentMethod as any,
        status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
        recordedById,
        evidenceUrl: evidenceUrl || payment.evidenceUrl,
        notes: notes || payment.notes,
      },
    });

    // Check if all payments are completed → update contract status
    if (isPaidInFull) {
      await this.checkContractCompletion(contractId);
    }

    return updated;
  }

  // ─── Auto-allocate payment to next pending installment ─
  async autoAllocatePayment(
    contractId: string,
    amount: number,
    paymentMethod: string,
    recordedById: string,
    notes?: string,
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { payments: { orderBy: { installmentNo: 'asc' } } },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    let remaining = amount;
    const results: Awaited<ReturnType<typeof this.recordPayment>>[] = [];

    // Get unpaid payments in order
    const unpaid = contract.payments.filter((p) => p.status !== 'PAID');
    if (unpaid.length === 0) throw new BadRequestException('ไม่มีงวดค้างชำระ');

    for (const payment of unpaid) {
      if (remaining <= 0) break;

      const amountDue = Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid);
      const payAmount = Math.min(remaining, amountDue);

      const updated = await this.recordPayment(
        contractId,
        payment.installmentNo,
        payAmount,
        paymentMethod,
        recordedById,
        undefined,
        notes,
      );
      results.push(updated);
      remaining -= payAmount;
    }

    return {
      allocatedPayments: results,
      totalAllocated: amount - remaining,
      overpayment: remaining > 0 ? remaining : 0,
    };
  }

  // ─── Get payments for a contract ──────────────────────
  async getContractPayments(contractId: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    return this.prisma.payment.findMany({
      where: { contractId },
      orderBy: { installmentNo: 'asc' },
      include: {
        recordedBy: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Get all pending payments (for payment queue view) ─
  async getPendingPayments(filters: { branchId?: string; date?: string; status?: string }) {
    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = filters.status;
    } else {
      where.status = { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] };
    }

    if (filters.branchId) {
      where.contract = { branchId: filters.branchId };
    }

    if (filters.date) {
      const d = new Date(filters.date);
      where.dueDate = {
        gte: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        lt: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
      };
    }

    return this.prisma.payment.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { installmentNo: 'asc' }],
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
    });
  }

  // ─── Daily summary ────────────────────────────────────
  async getDailySummary(date: string, branchId?: string) {
    const d = new Date(date);
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

    const where: Record<string, unknown> = {
      paidDate: { gte: startOfDay, lt: endOfDay },
      status: 'PAID',
    };

    if (branchId) {
      where.contract = { branchId };
    }

    const payments = await this.prisma.payment.findMany({
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
    });

    const totalAmount = payments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
    const totalLateFees = payments.reduce((sum, p) => sum + Number(p.lateFee), 0);

    const byMethod: Record<string, number> = {};
    payments.forEach((p) => {
      const method = p.paymentMethod || 'UNKNOWN';
      byMethod[method] = (byMethod[method] || 0) + Number(p.amountPaid);
    });

    return {
      date,
      totalPayments: payments.length,
      totalAmount: Math.round(totalAmount),
      totalLateFees: Math.round(totalLateFees),
      byMethod,
      payments,
    };
  }

  // ─── Check if contract is fully paid ──────────────────
  private async checkContractCompletion(contractId: string) {
    const unpaid = await this.prisma.payment.count({
      where: { contractId, status: { not: 'PAID' } },
    });

    if (unpaid === 0) {
      const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
      if (contract) {
        // All installments paid → mark contract as COMPLETED
        await this.prisma.contract.update({
          where: { id: contractId },
          data: { status: 'COMPLETED' },
        });

        // Only update product status if it's currently RESERVED or SOLD_INSTALLMENT
        const product = await this.prisma.product.findUnique({ where: { id: contract.productId } });
        if (product && ['RESERVED', 'SOLD_INSTALLMENT'].includes(product.status)) {
          await this.prisma.product.update({
            where: { id: contract.productId },
            data: { status: 'SOLD_INSTALLMENT' },
          });
        }
      }
    }
  }
}
