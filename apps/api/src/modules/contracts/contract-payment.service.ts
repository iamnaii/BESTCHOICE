import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BUSINESS_RULES } from '../../utils/config.util';

@Injectable()
export class ContractPaymentService {
  private readonly logger = new Logger(ContractPaymentService.name);
  constructor(
    private prisma: PrismaService,
  ) {}

  async getSchedule(id: string) {
    await this.findOne(id);
    return this.prisma.payment.findMany({
      where: { contractId: id },
      orderBy: { installmentNo: 'asc' },
    });
  }

  async getEarlyPayoffQuote(id: string) {
    const contract = await this.findOne(id);
    if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
    }

    // Guard: totalMonths must be positive to prevent division by zero
    if (!contract.totalMonths || contract.totalMonths <= 0) {
      throw new BadRequestException('ข้อมูลสัญญาผิดพลาด: จำนวนงวดต้องมากกว่า 0');
    }

    // Count fully paid AND partially paid installments
    const paidPayments = contract.payments.filter((p) => p.status === 'PAID');
    const partialPayments = contract.payments.filter((p) => p.status === 'PARTIALLY_PAID');
    const fullyPaidCount = paidPayments.length;
    const remainingMonths = contract.totalMonths - fullyPaidCount;

    if (remainingMonths <= 0) {
      throw new BadRequestException('ไม่มีงวดค้างชำระ ไม่จำเป็นต้องปิดก่อนกำหนด');
    }

    // Use satang-precision arithmetic (round at each step to avoid floating-point errors)
    const interestTotal = Number(contract.interestTotal);
    const financedAmount = Number(contract.financedAmount);
    const monthlyInterest = Math.round(interestTotal * 100 / contract.totalMonths) / 100;
    const truePrincipal = Math.round((financedAmount - interestTotal) * 100) / 100;
    const monthlyPrincipal = Math.round(truePrincipal * 100 / contract.totalMonths) / 100;

    const remainingPrincipal = Math.round(monthlyPrincipal * remainingMonths * 100) / 100;
    const remainingInterest = Math.round(monthlyInterest * remainingMonths * 100) / 100;
    const discount = Math.round(remainingInterest * BUSINESS_RULES.EARLY_PAYOFF_DISCOUNT * 100) / 100;

    // Deduct amounts already partially paid
    const partiallyPaidAmount = partialPayments.reduce(
      (sum, p) => sum + Number(p.amountPaid || 0), 0,
    );
    const totalPayoff = Math.max(0, remainingPrincipal + (remainingInterest - discount) - partiallyPaidAmount);

    // Add any unpaid late fees
    const unpaidLateFees = contract.payments
      .filter((p) => p.status !== 'PAID')
      .reduce((sum, p) => sum + Number(p.lateFee), 0);

    return {
      remainingMonths,
      remainingPrincipal: Math.round(remainingPrincipal),
      remainingInterest: Math.round(remainingInterest),
      discount: Math.round(discount),
      partiallyPaidCredit: Math.round(partiallyPaidAmount),
      unpaidLateFees,
      totalPayoff: Math.round(totalPayoff + unpaidLateFees),
    };
  }

  async earlyPayoff(id: string, userId: string, paymentMethod: string) {
    const quote = await this.getEarlyPayoffQuote(id);

    await this.prisma.$transaction(async (tx) => {
      // Re-verify contract status inside transaction to prevent race condition
      const freshContract = await tx.contract.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!freshContract || !['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(freshContract.status)) {
        throw new BadRequestException('สถานะสัญญาไม่อนุญาตให้ปิดก่อนกำหนด');
      }

      const unpaidPayments = await tx.payment.findMany({
        where: { contractId: id, status: { not: 'PAID' } },
        orderBy: { installmentNo: 'asc' },
      });

      let remainingPayoff = quote.totalPayoff;
      for (const payment of unpaidPayments) {
        const owed = Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid);
        const payAmount = Math.min(remainingPayoff, owed);
        remainingPayoff -= payAmount;

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            paidDate: new Date(),
            amountPaid: Number(payment.amountPaid) + payAmount,
            paymentMethod: paymentMethod as PaymentMethod,
            recordedById: userId,
          },
        });
      }

      await tx.contract.update({
        where: { id },
        data: { status: 'EARLY_PAYOFF' },
      });
    });

    return { ...quote, status: 'EARLY_PAYOFF' };
  }

  /** Shared findOne - reuses Prisma query for contract with full includes */
  private async findOne(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        customer: true,
        product: { include: { prices: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        interestConfig: true,
        payments: { orderBy: { installmentNo: 'asc' } },
        signatures: true,
        eDocuments: true,
        contractDocuments: {
          orderBy: { createdAt: 'desc' },
          include: { uploadedBy: { select: { id: true, name: true } } },
        },
        creditCheck: {
          include: {
            checkedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    return contract;
  }
}
