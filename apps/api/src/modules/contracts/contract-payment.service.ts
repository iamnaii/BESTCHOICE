import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
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

    // Use Decimal arithmetic to avoid floating-point precision loss
    const decInterestTotal = new Prisma.Decimal(contract.interestTotal);
    const decFinancedAmount = new Prisma.Decimal(contract.financedAmount);
    const decMonthlyInterest = decInterestTotal.div(contract.totalMonths).toDecimalPlaces(2);
    const decTruePrincipal = decFinancedAmount.sub(decInterestTotal).toDecimalPlaces(2);
    const decMonthlyPrincipal = decTruePrincipal.div(contract.totalMonths).toDecimalPlaces(2);

    const decRemainingPrincipal = decMonthlyPrincipal.mul(remainingMonths).toDecimalPlaces(2);
    const decRemainingInterest = decMonthlyInterest.mul(remainingMonths).toDecimalPlaces(2);
    const decDiscount = decRemainingInterest.mul(BUSINESS_RULES.EARLY_PAYOFF_DISCOUNT).toDecimalPlaces(2);

    // Deduct amounts already partially paid
    const decPartiallyPaid = partialPayments.reduce(
      (sum, p) => sum.add(new Prisma.Decimal(p.amountPaid || 0)),
      new Prisma.Decimal(0),
    );
    const decTotalPayoff = Prisma.Decimal.max(
      new Prisma.Decimal(0),
      decRemainingPrincipal.add(decRemainingInterest).sub(decDiscount).sub(decPartiallyPaid),
    );

    // Add any unpaid late fees
    const decUnpaidLateFees = contract.payments
      .filter((p) => p.status !== 'PAID')
      .reduce((sum, p) => sum.add(new Prisma.Decimal(p.lateFee)), new Prisma.Decimal(0));

    return {
      remainingMonths,
      remainingPrincipal: decRemainingPrincipal.round().toNumber(),
      remainingInterest: decRemainingInterest.round().toNumber(),
      discount: decDiscount.round().toNumber(),
      partiallyPaidCredit: decPartiallyPaid.round().toNumber(),
      unpaidLateFees: decUnpaidLateFees.toNumber(),
      totalPayoff: decTotalPayoff.add(decUnpaidLateFees).round().toNumber(),
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

      let decRemainingPayoff = new Prisma.Decimal(quote.totalPayoff);
      for (const payment of unpaidPayments) {
        const decOwed = new Prisma.Decimal(payment.amountDue)
          .add(new Prisma.Decimal(payment.lateFee))
          .sub(new Prisma.Decimal(payment.amountPaid));
        const decPayAmount = Prisma.Decimal.min(decRemainingPayoff, decOwed);
        decRemainingPayoff = decRemainingPayoff.sub(decPayAmount);

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            paidDate: new Date(),
            amountPaid: new Prisma.Decimal(payment.amountPaid).add(decPayAmount),
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
