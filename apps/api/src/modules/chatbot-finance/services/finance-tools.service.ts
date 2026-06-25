import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { FinanceConfigService } from './finance-config.service';
import { formatThaiDateText as formatThaiDate } from '../../../utils/thai-date.util';
import { computeBracketLateFee } from '../../../utils/late-fee.util';
import { BUSINESS_RULES } from '../../../utils/config.util';

/**
 * Finance Tools — wrap DB queries สำหรับ Claude tool use
 *
 * ทุก method:
 * - รับ customerId (verified แล้ว)
 * - return plain object (จะถูก JSON.stringify ส่งให้ Claude)
 * - ห้าม return PII เช่น เลขบัตร, เลขบัญชี
 * - ตัวเลขเป็น number (ไม่ใช่ Decimal) — convert ก่อน return
 */
@Injectable()
export class FinanceToolsService {
  private readonly logger = new Logger(FinanceToolsService.name);

  constructor(
    private prisma: PrismaService,
    private financeConfig: FinanceConfigService,
  ) {}

  // ─── Tool 1: get_current_balance ─────────────────────────

  /**
   * ดึงยอดที่ต้องชำระงวดถัดไป + ค่าปรับ (ถ้าเลยกำหนด)
   */
  async getCurrentBalance(customerId: string) {
    const contract = await this.findActiveContract(customerId);
    if (!contract) {
      return { found: false, message: 'ไม่พบสัญญาที่ active' };
    }

    // หา payment งวดถัดไปที่ยังไม่จ่าย
    const nextPayment = await this.prisma.payment.findFirst({
      where: {
        contractId: contract.id,
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      orderBy: { installmentNo: 'asc' },
    });

    if (!nextPayment) {
      return {
        found: true,
        contractNumber: contract.contractNumber,
        message: 'คุณชำระครบทุกงวดแล้วค่ะ ขอบคุณค่ะ 😊',
      };
    }

    const amountDue = Number(nextPayment.amountDue);
    const amountPaid = Number(nextPayment.amountPaid);
    const remainingBase = amountDue - amountPaid;

    // คำนวณค่าปรับถ้าเลยกำหนด
    const now = new Date();
    const daysOverdue = Math.max(
      0,
      Math.floor((now.getTime() - nextPayment.dueDate.getTime()) / (1000 * 60 * 60 * 24)),
    );
    // Late fee MUST match what the collection path actually charges
    // (payments.service.recordPayment): flat bracket — tier1 for 1..(min-1) days,
    // tier2 for >= min days. The bot used to quote an UNCAPPED per-day rate,
    // over-stating the fine (e.g. 3,000 quoted vs 100 charged).
    const { tier1, tier2, tier2MinDays } = await this.getLateFeeBracketConfig();
    const lateFee = nextPayment.lateFeeWaived
      ? 0
      : Number(computeBracketLateFee({ daysOverdue, tier1Amount: tier1, tier2Amount: tier2, tier2MinDays }));
    const totalAmount = remainingBase + lateFee;

    return {
      found: true,
      contractNumber: contract.contractNumber,
      installmentNumber: nextPayment.installmentNo,
      dueDate: formatThaiDate(nextPayment.dueDate),
      amountDue: remainingBase,
      lateFee,
      totalAmount,
      daysOverdue,
      isOverdue: daysOverdue > 0,
      bankInfo: this.financeConfig.bankInfoBlock,
    };
  }

  // ─── Tool 2: get_payment_schedule ────────────────────────

  /**
   * ดึงสรุปตารางผ่อน (จำนวนงวด, จ่ายแล้ว, คงเหลือ)
   */
  async getPaymentSchedule(customerId: string) {
    const contract = await this.findActiveContract(customerId);
    if (!contract) {
      return { found: false, message: 'ไม่พบสัญญาที่ active' };
    }

    const payments = await this.prisma.payment.findMany({
      where: { contractId: contract.id },
      orderBy: { installmentNo: 'asc' },
      select: {
        installmentNo: true,
        dueDate: true,
        amountDue: true,
        amountPaid: true,
        status: true,
        paidDate: true,
      },
    });

    const totalInstallments = payments.length;
    const paidInstallments = payments.filter((p) => p.status === 'PAID').length;
    const remainingInstallments = totalInstallments - paidInstallments;

    const totalAmount = payments.reduce((s, p) => s + Number(p.amountDue), 0);
    const paidAmount = payments
      .filter((p) => p.status === 'PAID')
      .reduce((s, p) => s + Number(p.amountPaid), 0);
    const remainingAmount = totalAmount - paidAmount;

    const nextUnpaid = payments.find((p) => p.status !== 'PAID');

    return {
      found: true,
      contractNumber: contract.contractNumber,
      productName: contract.product?.model || 'ไม่ระบุ',
      totalInstallments,
      paidInstallments,
      remainingInstallments,
      totalAmount: Math.round(totalAmount * 100) / 100,
      paidAmount: Math.round(paidAmount * 100) / 100,
      remainingAmount: Math.round(remainingAmount * 100) / 100,
      nextDueDate: nextUnpaid ? formatThaiDate(nextUnpaid.dueDate) : null,
      nextAmount: nextUnpaid ? Number(nextUnpaid.amountDue) : null,
    };
  }

  /**
   * Late-fee bracket config — reads the SAME SystemConfig keys + defaults as the
   * collection path (payments.service.recordPayment), so the chatbot quote
   * matches what the customer is actually charged.
   */
  private async getLateFeeBracketConfig(): Promise<{ tier1: number; tier2: number; tier2MinDays: number }> {
    const [t1, t2, minDays] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'late_fee_tier1_amount' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'late_fee_tier2_amount' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'late_fee_tier2_min_days' } }),
    ]);
    return {
      tier1: t1 ? Number(t1.value) : BUSINESS_RULES.LATE_FEE_TIER1_AMOUNT,
      tier2: t2 ? Number(t2.value) : BUSINESS_RULES.LATE_FEE_TIER2_AMOUNT,
      tier2MinDays: minDays ? Number(minDays.value) : BUSINESS_RULES.LATE_FEE_TIER2_MIN_DAYS,
    };
  }

  // ─── Tool 3: calculate_fine ──────────────────────────────

  /**
   * คำนวณค่าปรับโดยประมาณสำหรับจำนวนวันที่เลยกำหนด — flat bracket:
   *   1..(tier2MinDays-1) วัน = tier1 บาท, >= tier2MinDays วัน = tier2 บาท
   */
  async calculateFine(daysOverdue: number) {
    const days = Math.max(0, Math.floor(daysOverdue));
    const { tier1, tier2, tier2MinDays } = await this.getLateFeeBracketConfig();
    const totalFine = Number(computeBracketLateFee({ daysOverdue: days, tier1Amount: tier1, tier2Amount: tier2, tier2MinDays }));
    return {
      daysOverdue: days,
      totalFine,
      explanation:
        `ค่าปรับล่าช้าแบบเหมาจ่าย: 1–${tier2MinDays - 1} วัน = ${tier1} บาท, ` +
        `ตั้งแต่ ${tier2MinDays} วันขึ้นไป = ${tier2} บาท` +
        ` — งวดนี้เลย ${days} วัน ≈ ${totalFine} บาท`,
    };
  }

  // ─── Tool 4: list_recent_receipts ────────────────────────

  /**
   * ดึงประวัติใบเสร็จล่าสุด (5 งวดล่าสุดที่จ่ายแล้ว)
   */
  async listRecentReceipts(customerId: string) {
    const contract = await this.findActiveContract(customerId);
    if (!contract) {
      return { found: false, message: 'ไม่พบสัญญา' };
    }

    const paid = await this.prisma.payment.findMany({
      where: { contractId: contract.id, status: 'PAID' },
      orderBy: { paidDate: 'desc' },
      take: 5,
      select: {
        installmentNo: true,
        amountPaid: true,
        paidDate: true,
      },
    });

    return {
      found: true,
      contractNumber: contract.contractNumber,
      receipts: paid.map((p) => ({
        installmentNumber: p.installmentNo,
        amount: Number(p.amountPaid),
        paidDate: p.paidDate ? formatThaiDate(p.paidDate) : null,
      })),
    };
  }

  // ─── Tool 5: get_bank_info ───────────────────────────────

  /**
   * คืนข้อมูลบัญชีบริษัทสำหรับโอนเงิน (จาก SystemConfig)
   */
  getBankInfo() {
    return {
      bankName: this.financeConfig.bankName,
      accountNumber: this.financeConfig.accountNumber,
      accountName: this.financeConfig.accountName,
      formatted: this.financeConfig.bankInfoBlock,
    };
  }

  // ─── private helpers ─────────────────────────────────────

  /**
   * Find active contract for customer.
   * If multiple contracts exist, returns the most recent one
   * and includes a `hasMultipleContracts` flag for disambiguation.
   */
  private async findActiveContract(customerId: string) {
    const contracts = await this.prisma.contract.findMany({
      where: {
        customerId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        product: { select: { model: true, color: true } },
      },
    });

    if (contracts.length === 0) return null;

    const primary = contracts[0];
    // Spread instead of Object.assign to avoid mutating Prisma result
    return {
      ...primary,
      hasMultipleContracts: contracts.length > 1,
      ...(contracts.length > 1 && {
        contractSummaries: contracts.map((c) => ({
          contractNumber: c.contractNumber,
          product: c.product?.model ?? 'ไม่ระบุ',
          status: c.status,
        })),
      }),
    };
  }

}
