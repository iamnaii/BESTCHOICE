import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EarlyPayoffDto } from './dto/contract.dto';

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

  /**
   * คำนวณยอดปิดสัญญาก่อนกำหนด (FINANCE perspective)
   *
   * Logic:
   *   (1) รวมค้างชำระ      = ค่างวด × งวดคงเหลือ (รวม VAT)
   *   (2) ยอดชำระล่วงหน้า  = creditBalance + partialPayments
   *   (3) คงเหลือยอดค้าง   = (1) - (2)
   *   (4) ค่างวดไม่รวม VAT = (3) ÷ (1 + vatPct)
   *   (5) ต้นทุนยอดค้าง    = (financedAmount + storeCommission) ÷ totalMonths × งวดคงเหลือ
   *   (6) กำไรขั้นต้น      = (4) - (5)
   *   (7) ส่วนลด           = (6) × discountPct
   *   (8) ยอดชำระปิดยอด    = (3) - (7)
   */
  async getEarlyPayoffQuote(id: string, discountPctInput?: number) {
    const contract = await this.findOne(id);
    if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
    }
    if (!contract.totalMonths || contract.totalMonths <= 0) {
      throw new BadRequestException('ข้อมูลสัญญาผิดพลาด: จำนวนงวดต้องมากกว่า 0');
    }

    const fullyPaidCount = contract.payments.filter(p => p.status === 'PAID').length;
    const remainingMonths = contract.totalMonths - fullyPaidCount;
    if (remainingMonths <= 0) {
      throw new BadRequestException('ไม่มีงวดค้างชำระ ไม่จำเป็นต้องปิดก่อนกำหนด');
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const monthlyPayment = Number(contract.monthlyPayment);

    // (1) รวมค้างชำระ (รวม VAT)
    const totalRemaining = round2(monthlyPayment * remainingMonths);

    // (2) ยอดชำระล่วงหน้า / partial credit
    const creditBalance = Number(contract.creditBalance || 0);
    const partialPaid = contract.payments
      .filter(p => p.status === 'PARTIALLY_PAID')
      .reduce((s, p) => s + Number(p.amountPaid || 0), 0);
    const advancePayment = round2(creditBalance + partialPaid);

    // (3) คงเหลือยอดค้าง
    const remainingBalance = round2(totalRemaining - advancePayment);

    // (4) ค่างวดไม่รวม VAT
    const vatPct = Number(contract.vatPct || 0);
    const remainingExVat = vatPct > 0 ? round2(remainingBalance / (1 + vatPct)) : remainingBalance;

    // (5) ต้นทุนยอดค้าง = (financedAmount + storeCommission) / totalMonths × remainingMonths
    const financeCost = Number(contract.financedAmount) + Number(contract.storeCommission || 0);
    const remainingCost = round2((financeCost / contract.totalMonths) * remainingMonths);

    // (6) กำไรขั้นต้น (อาจติดลบในเคสประหลาด → clamp 0)
    const grossProfit = Math.max(0, round2(remainingExVat - remainingCost));

    // (7) ส่วนลด (default 50%)
    // Cap ส่วนลดที่ 50% ตามนโยบาย
    const discountPct = discountPctInput != null ? Math.max(0, Math.min(50, discountPctInput)) / 100 : 0.5;
    const discountAmount = round2(grossProfit * discountPct);

    // (8) ยอดชำระปิดยอด
    const totalPayoff = Math.max(0, round2(remainingBalance - discountAmount));

    // Late fees (ไม่ลด — ตามนโยบาย "ไม่คิด VAT ค่าปรับ")
    const unpaidLateFees = contract.payments
      .filter(p => p.status !== 'PAID' && !p.lateFeeWaived)
      .reduce((s, p) => s + Number(p.lateFee), 0);

    return {
      monthlyPayment: round2(monthlyPayment),
      remainingMonths,
      totalRemaining,
      advancePayment,
      remainingBalance,
      remainingExVat,
      remainingCost,
      grossProfit,
      discountPct: discountPct * 100, // return as percentage 0-100
      discountAmount,
      unpaidLateFees,
      totalPayoff: round2(totalPayoff + unpaidLateFees),
    };
  }

  async earlyPayoff(id: string, userId: string, dto: EarlyPayoffDto) {
    const quote = await this.getEarlyPayoffQuote(id, dto.discountPct);
    const paidDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();

    // Require reference for non-cash methods
    if (dto.paymentMethod !== 'CASH' && !dto.referenceNo && !dto.slipUrl) {
      throw new BadRequestException('กรุณาระบุเลขที่อ้างอิงหรือแนบสลิปสำหรับการชำระแบบโอน/QR');
    }

    await this.prisma.$transaction(async (tx) => {
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

      // Distribute totalPayoff across unpaid installments (FIFO)
      let remainingPayoff = quote.totalPayoff;
      for (const payment of unpaidPayments) {
        const lateFee = payment.lateFeeWaived ? 0 : Number(payment.lateFee);
        const owed = Number(payment.amountDue) + lateFee - Number(payment.amountPaid);
        const payAmount = Math.min(remainingPayoff, Math.max(0, owed));
        remainingPayoff -= payAmount;

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            paidDate,
            amountPaid: Number(payment.amountPaid) + payAmount,
            paymentMethod: dto.paymentMethod as PaymentMethod,
            recordedById: userId,
            evidenceUrl: dto.slipUrl ?? payment.evidenceUrl,
            gatewayRef: dto.referenceNo ?? payment.gatewayRef,
            notes: dto.notes
              ? `[ปิดก่อนกำหนด] ${dto.notes}`
              : '[ปิดก่อนกำหนด]',
          },
        });
      }

      // Reset credit balance (used up by the early payoff)
      await tx.contract.update({
        where: { id },
        data: {
          status: 'EARLY_PAYOFF',
          creditBalance: 0,
        },
      });
    });

    return { ...quote, status: 'EARLY_PAYOFF', paidDate };
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
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
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
