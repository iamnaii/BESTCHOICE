import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { paginatedResponse } from '../../../common/helpers/pagination.helper';
import { roundBaht } from '../../../utils/installment.util';

/**
 * Read-side queries + the tiny partial-QR writes (cancelActivePartialQr). No
 * journal, no money math, no $transaction. Bodies moved VERBATIM from the legacy
 * PaymentsService. Constructed internally by PaymentsService.
 */
@Injectable()
export class PaymentQueryService {
  constructor(private prisma: PrismaService) {}

  // ─── Get payments for a contract ──────────────────────
  async getContractPayments(contractId: string, page = 1, limit = 50) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const where = { contractId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { installmentNo: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          recordedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  // ─── Get all pending payments (for payment queue view) ─
  async getPendingPayments(filters: {
    branchId?: string;
    date?: string;
    status?: string;
    search?: string;
    dunningStage?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (filters.status) {
      where.status = filters.status;
    } else {
      where.status = { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] };
    }

    // Build contract filter object to combine multiple conditions
    // Only show payments for APPROVED contracts (not DRAFT/CREATING/PENDING_REVIEW)
    const contractWhere: Record<string, unknown> = {
      workflowStatus: 'APPROVED',
      deletedAt: null,
    };

    if (filters.branchId) {
      contractWhere.branchId = filters.branchId;
    }

    if (filters.dunningStage) {
      contractWhere.dunningStage = filters.dunningStage;
    }

    if (filters.search) {
      const search = filters.search.trim();
      contractWhere.OR = [
        { contractNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search } } },
      ];
    }

    // Always apply contract filter (at minimum: workflowStatus + deletedAt)
    where.contract = contractWhere;

    if (filters.date) {
      const d = new Date(filters.date);
      where.dueDate = {
        gte: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        lt: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
      };
    }

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { installmentNo: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          contract: {
            select: {
              id: true,
              contractNumber: true,
              totalMonths: true,
              monthlyPayment: true,
              advanceBalance: true,
              customer: { select: { id: true, name: true, phone: true } },
              branch: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  // ─── Daily summary ────────────────────────────────────
  async getDailySummary(date: string, branchId?: string, page = 1, limit = 50) {
    const d = new Date(date);
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

    const where: Record<string, unknown> = {
      paidDate: { gte: startOfDay, lt: endOfDay },
      status: 'PAID',
      deletedAt: null,
    };

    if (branchId) {
      where.contract = { branchId };
    }

    const [payments, total, aggregation] = await Promise.all([
      this.prisma.payment.findMany({
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
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({
        where,
        _sum: { amountPaid: true, lateFee: true },
      }),
    ]);

    // Compute byMethod from the current page (for display) — summary totals use aggregate
    const byMethod: Record<string, number> = {};
    payments.forEach((p) => {
      const method = p.paymentMethod || 'UNKNOWN';
      byMethod[method] = roundBaht(
        new Prisma.Decimal(byMethod[method] ?? 0)
          .add(new Prisma.Decimal(p.amountPaid ?? 0))
          .toNumber(),
      );
    });

    // W6 fix: the previous Math.round(Decimal.toNumber()) silently dropped
    // satang on every daily total — a day collecting 152.50 + 99.17 + ...
    // was rounded to whole baht for the summary card. Drop the Math.round
    // and keep two-decimal precision; the UI side already calls .toLocaleString
    // which formats both ints and floats consistently.
    const totalAmount = new Prisma.Decimal(aggregation._sum.amountPaid ?? 0)
      .toDecimalPlaces(2)
      .toNumber();
    const totalLateFees = new Prisma.Decimal(aggregation._sum.lateFee ?? 0)
      .toDecimalPlaces(2)
      .toNumber();
    return {
      date,
      totalPayments: total,
      totalAmount,
      totalLateFees,
      byMethod,
      data: payments,
      total,
      page,
      limit,
    };
  }

  // ─── Get credit balance for a contract ─────────────
  async getCreditBalance(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, contractNumber: true, creditBalance: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    // I1 fix: return as 2-dp string (Decimal precision preserved) instead of
    // Number(...) which silently degrades to IEEE-754 binary float and can
    // drift on large balances. UI parses with parseFloat / formatNumber.
    return {
      creditBalance: new Prisma.Decimal(contract.creditBalance.toString()).toFixed(2),
    };
  }

  // ─── Partial-payment QR (cashier sends QR to customer's LINE) ─────────────
  // Customer pays via PaySolutions PromptPay → webhook auto-records as PARTIAL.
  // The active link powers the "QR ส่งแล้ว" badge in the payments table.

  /** Get the currently-active (un-expired) partial-payment QR link for a payment. */
  async getActivePartialQr(paymentId: string) {
    return this.prisma.partialPaymentLink.findFirst({
      where: {
        paymentId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Cancel the currently-active partial-payment QR link, if one exists. */
  async cancelActivePartialQr(paymentId: string) {
    const link = await this.prisma.partialPaymentLink.findFirst({
      where: { paymentId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!link) throw new NotFoundException('ไม่มี QR ที่กำลังใช้งานอยู่');
    return this.prisma.partialPaymentLink.update({
      where: { id: link.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }
}
