import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReceiptsService } from '../receipts/receipts.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private receiptsService: ReceiptsService,
  ) {}

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

    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
      throw new BadRequestException('ไม่สามารถชำระเงินได้ สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { contractId, installmentNo },
    });
    if (!payment) throw new NotFoundException('ไม่พบงวดที่ต้องการ');
    if (payment.status === 'PAID') throw new BadRequestException('งวดนี้ชำระแล้ว');

    const amountDue = Number(payment.amountDue) + Number(payment.lateFee);
    const prevPaid = Number(payment.amountPaid);
    const remaining = amountDue - prevPaid;

    // Prevent overpayment: cap amount at what is owed for this installment
    if (amount > remaining) {
      throw new BadRequestException(
        `จำนวนเงินเกินยอดค้างชำระ (ยอดค้าง ${remaining.toLocaleString()} บาท, ชำระ ${amount.toLocaleString()} บาท) กรุณาใช้ระบบจัดสรรอัตโนมัติสำหรับการชำระหลายงวด`,
      );
    }
    const totalPaid = prevPaid + amount;

    const isPaidInFull = totalPaid >= amountDue;

    // Wrap payment update + contract completion check in a transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.update({
        where: { id: payment.id },
        data: {
          amountPaid: totalPaid,
          paidDate: isPaidInFull ? new Date() : null,
          paymentMethod: paymentMethod as PaymentMethod,
          status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
          recordedById,
          evidenceUrl: evidenceUrl || payment.evidenceUrl,
          notes: notes || payment.notes,
        },
      });

      // Check if all payments are completed → update contract status
      if (isPaidInFull) {
        await this.checkContractCompletion(contractId, tx);
      }

      return result;
    });

    // Auto-generate e-Receipt after successful payment
    if (updated.status === 'PAID') {
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
      } catch {
        // Receipt generation failure should not block payment
      }
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
    if (!amount || amount <= 0) {
      throw new BadRequestException('จำนวนเงินต้องมากกว่า 0');
    }

    // Wrap entire allocation in a serializable transaction to prevent double-payment
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
        include: { payments: { orderBy: { installmentNo: 'asc' } } },
      });
      if (!contract) throw new NotFoundException('ไม่พบสัญญา');
      if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
        throw new BadRequestException('ไม่สามารถชำระเงินได้ สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
      }

      let remaining = amount;
      const results: any[] = [];

      // Get unpaid payments in order
      const unpaid = contract.payments.filter((p) => p.status !== 'PAID');
      if (unpaid.length === 0) throw new BadRequestException('ไม่มีงวดค้างชำระ');

      for (const payment of unpaid) {
        if (remaining <= 0) break;

        const amountDue = Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid);
        const payAmount = Math.min(remaining, amountDue);
        const totalPaid = Number(payment.amountPaid) + payAmount;
        const isPaidInFull = totalPaid >= (Number(payment.amountDue) + Number(payment.lateFee));

        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: totalPaid,
            paidDate: isPaidInFull ? new Date() : null,
            paymentMethod: paymentMethod as PaymentMethod,
            status: isPaidInFull ? 'PAID' : 'PARTIALLY_PAID',
            recordedById,
            notes: notes || payment.notes,
          },
        });

        results.push(updated);
        remaining -= payAmount;

        // Check contract completion after each full payment
        if (isPaidInFull) {
          await this.checkContractCompletion(contractId, tx);
        }
      }

      // Auto-generate e-Receipts for fully paid installments
      for (const paid of results.filter(r => r.status === 'PAID')) {
        try {
          await this.receiptsService.generateReceipt(
            contractId,
            paid.id,
            'INSTALLMENT',
            Number(paid.amountPaid),
            paid.installmentNo,
            paymentMethod,
            null,
            recordedById,
          );
        } catch {
          // Receipt generation failure should not block payment
        }
      }

      return {
        allocatedPayments: results,
        totalAllocated: amount - remaining,
        overpayment: remaining > 0 ? remaining : 0,
      };
    });
  }

  // ─── Get payments for a contract ──────────────────────
  async getContractPayments(contractId: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

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
  private async checkContractCompletion(contractId: string, tx?: { payment: { count: (...args: any[]) => Promise<number> }; contract: { update: (...args: any[]) => Promise<any> } }) {
    const db = tx || this.prisma;
    const unpaid = await db.payment.count({
      where: { contractId, status: { not: 'PAID' } },
    });

    if (unpaid === 0) {
      // All installments paid → mark contract as COMPLETED
      await db.contract.update({
        where: { id: contractId },
        data: { status: 'COMPLETED' },
      });
    }
  }
}
