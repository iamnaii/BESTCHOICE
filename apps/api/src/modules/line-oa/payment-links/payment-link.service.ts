import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessageRole,
  MessageType,
  ChatChannel,
  DunningEventTrigger,
  LineChannelType,
  PaymentLinkPurpose,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FINANCE_LINE_RECIPIENT_SELECT } from '../../line-oa/services/otp-verified-customer';
import { calcOutstanding, toNum as d } from '../../../utils/decimal.util';
import { maskThaiName } from '../../../utils/mask-name.util';
import { formatDateShort } from '../../../utils/thai-date.util';
import { PromptPayQrService } from '../promptpay/promptpay-qr.service';
import { FlexTemplatesService } from '../flex-templates.service';
import { LineFinanceClientService } from '../../chatbot-finance/services/line-finance-client.service';
import { hasActivePdpaConsent } from '../../pdpa/active-consent';
import { NOT_SENT_REASON_TEXT } from '../../notifications/send-outcome';
import { randomBytes } from 'crypto';
import type { LiffPayAllocationLine } from '@installment/shared';
import {
  allocatePaidAmountFifo,
  fifoUnpaidPaymentsArgs,
  payAllocationPreviewLines,
  payLinkAmountKind,
  type InstallmentLedgerSoFar,
} from '../../paysolutions/pay-allocation';
import {
  accrual2AInputOf,
  type Accrual2AContractFields,
} from '../../journal/build-accrual-2a-lines';
import { computeInstallmentBreakdown } from '../../journal/compute-installment-breakdown';
import { reconstructPriorCleared } from '../../journal/reconstruct-prior';

@Injectable()
export class PaymentLinkService {
  private readonly logger = new Logger(PaymentLinkService.name);
  private readonly baseUrl: string;
  private readonly expiryHours: number;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private promptPayQrService: PromptPayQrService,
    private flexTemplates: FlexTemplatesService,
    private lineFinanceClient: LineFinanceClientService,
  ) {
    // Fall back to FRONTEND_URL (always set in prod) before the placeholder —
    // missing PAYMENT_LINK_BASE_URL previously produced bestchoice.example.com
    // links that LINE's in-app browser failed to resolve.
    this.baseUrl =
      this.configService.get<string>('PAYMENT_LINK_BASE_URL') ||
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:5173';
    this.expiryHours = 24; // Payment links expire in 24 hours
  }

  /**
   * Create a payment link for a specific contract/installment.
   *
   * Task 39 — `PaymentLink.purpose` บอกว่าเงินของลิงก์จ่ายอะไร (หน้า `/pay/:token` ตัดสินจากค่านี้ ไม่เดาจากยอด):
   * ไม่ส่ง `override` ⇒ `INSTALLMENT` ยอด = ยอดคงค้างของงวดที่ผูก (งวดที่ระบุ หรืองวดค้างแรก) · ส่ง `override` ⇒ ผู้เรียกบอกยอดและ
   * purpose เอง: `INSTALLMENT` (ยอดคงค้างของงวดที่ระบุ) · `PAYOFF` (ยอดปิดสัญญา — ด่าน #24 ตอนจ่าย) · `AMOUNT` (ยอดที่ข้อความทวงบอก) ·
   * ลิงก์ที่ไม่ใช่ `INSTALLMENT` จ่ายด้วยยอดของลิงก์ (intent ทาง token) แล้ว webhook กระจาย FIFO · `paymentId` = งวดค้างแรก (แสดงเท่านั้น)
   *
   * Task 42 — `sourceEvent` = กฎทวงตามเหตุการณ์ที่สร้างลิงก์ `AMOUNT` (หัวยอดของหน้า `/pay/:token` · งานปลดล็อคหลังเงินเข้า) ·
   * `promiseDate` = วันนัดของลิงก์ยอดนัด · ไม่ส่ง = null
   */
  async createPaymentLink(
    contractId: string,
    installmentNo?: number,
    override?: {
      amount: number;
      purpose: PaymentLinkPurpose;
      sourceEvent?: DunningEventTrigger;
      promiseDate?: Date;
    },
  ): Promise<{
    token: string;
    url: string;
    expiresAt: Date;
    amount: number;
  }> {
    // Find the contract and next pending payment
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        payments: {
          orderBy: { installmentNo: 'asc' },
          where: installmentNo ? { installmentNo } : { status: { not: 'PAID' } },
          take: 1,
        },
      },
    });

    if (!contract) {
      throw new NotFoundException('ไม่พบสัญญา');
    }

    const payment = contract.payments[0];
    if (!payment) {
      throw new NotFoundException('ไม่พบงวดค้างชำระ');
    }

    const amount = override?.amount ?? calcOutstanding(payment);
    const purpose: PaymentLinkPurpose = override?.purpose ?? PaymentLinkPurpose.INSTALLMENT;

    // Generate unique token
    const token = randomBytes(32).toString('hex');

    // Set expiry time
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.expiryHours);

    // Create payment link record
    await this.prisma.paymentLink.create({
      data: {
        token,
        contractId,
        paymentId: payment.id,
        amount,
        purpose,
        sourceEvent: override?.sourceEvent ?? null,
        promiseDate: override?.promiseDate ?? null,
        status: 'ACTIVE',
        expiresAt,
      },
    });

    const url = `${this.baseUrl}/pay/${token}`;

    this.logger.log(
      `Payment link created for contract ${contract.contractNumber} installment ${payment.installmentNo}`,
    );

    return { token, url, expiresAt, amount };
  }

  /**
   * Validate and retrieve payment link details
   */
  async getPaymentLink(token: string) {
    const link = await this.prisma.paymentLink.findUnique({
      where: { token },
      include: {
        contract: {
          include: {
            customer: { select: { name: true, phone: true, ...FINANCE_LINE_RECIPIENT_SELECT } },
            payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
          },
        },
        payment: true,
      },
    });

    if (!link) {
      return null;
    }

    // Check expiry
    if (link.expiresAt < new Date()) {
      // Auto-expire
      if (link.status === 'ACTIVE') {
        await this.prisma.paymentLink.update({
          where: { id: link.id },
          data: { status: 'EXPIRED' },
        });
      }
      return { ...link, status: 'EXPIRED' as const };
    }

    return link;
  }

  /**
   * Mark payment link as used
   */
  async markAsUsed(token: string): Promise<void> {
    await this.prisma.paymentLink.update({
      where: { token },
      data: {
        status: 'USED',
        usedAt: new Date(),
      },
    });
  }

  /**
   * Expire old payment links (cleanup job)
   */
  async expireOldLinks(): Promise<number> {
    const result = await this.prisma.paymentLink.updateMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} payment links`);
    }

    return result.count;
  }

  /**
   * Resolve a payment-link token into the masked LIFF response payload
   * (contract + payment + PromptPay QR). Returns the non-throwing
   * `{ valid: false, ... }` variants for invalid / expired / non-contract links.
   */
  async resolvePaymentLink(token: string) {
    const link = await this.getPaymentLink(token);

    if (!link) {
      return { error: 'ลิงก์ชำระเงินไม่ถูกต้อง', valid: false };
    }

    if (link.status !== 'ACTIVE') {
      return { error: 'ลิงก์ชำระเงินหมดอายุหรือถูกใช้แล้ว', valid: false, status: link.status };
    }

    // This LIFF endpoint only handles contract-based payment links.
    // Online-order PaymentLinks (contract === null) are paid via PaySolutions hosted page.
    if (!link.contract) {
      return { error: 'ลิงก์ชำระเงินไม่ถูกต้อง', valid: false };
    }

    const payment = link.payment!;
    const contract = link.contract;
    // Use link.amount (authoritative) — createPaymentLink honors the
    // overrideAmount for early-payoff links. Recomputing from the linked
    // installment would return the single-installment total, not the full
    // payoff amount.
    const amount = d(link.amount);

    // Generate PromptPay QR as data URL for the LIFF page
    let qrDataUrl: string | null = null;
    try {
      qrDataUrl = await this.promptPayQrService.generateQrDataUrl(amount);
    } catch (err) {
      this.logger.warn(`QR generation failed for payment link: ${err}`);
    }

    // Task 42 — ลิงก์ AMOUNT (ยอดค้างรวมแจ้งล็อก · ยอดนัด): แถว "นำไปชำระ (งวดเก่าก่อน)" = สิ่งที่ webhook จะกระจายยอดของลิงก์นี้
    // ณ ตอนนี้ (งวดค้างปัจจุบัน — ฟังก์ชันเดียวกับ webhook) · ลิงก์งวด / ปิดยอด / แถวเก่า ไม่มีแถวนี้ (การ์ดเดิม)
    const allocation =
      link.purpose === PaymentLinkPurpose.AMOUNT
        ? await this.allocationPreview(contract, new Prisma.Decimal(link.amount))
        : null;

    return {
      valid: true,
      token,
      amount,
      status: link.status,
      expiresAt: link.expiresAt,
      // Task 39 — หน้า /pay/:token ส่งเลขงวดเฉพาะลิงก์ INSTALLMENT · อื่น ๆ ส่ง token แล้ว server ใช้ยอดของลิงก์
      purpose: link.purpose,
      // Task 42 — หัวยอด (server ตัดสินจาก purpose + กฎที่สร้างลิงก์) · วันนัด · แถวนำไปชำระ — ไม่มีข้อมูลส่วนตัวเพิ่ม
      amountKind: payLinkAmountKind(link.purpose, link.sourceEvent),
      promiseDate: link.promiseDate,
      allocation,
      contract: {
        id: contract.id,
        contractNumber: contract.contractNumber,
        customer: { name: maskThaiName(contract.customer.name) },
      },
      payment: {
        installmentNo: payment.installmentNo,
        amountDue: d(payment.amountDue),
        lateFee: d(payment.lateFee),
        dueDate: payment.dueDate,
      },
      promptPay: {
        qrDataUrl,
        accountName: this.promptPayQrService.getAccountName(),
        maskedId: this.promptPayQrService.getMaskedPromptPayId(),
      },
    };
  }

  /**
   * Task 42 — แถว "นำไปชำระ (งวดเก่าก่อน)": การกระจายของ webhook (`fifoUnpaidPaymentsArgs` + `allocatePaidAmountFifo`) แล้วแบ่งค่างวด/ค่าปรับ
   * ด้วย `splitReceipt` ข้อมูลชุดเดียวกับใบรับชำระที่ webhook จะลง (รีวิว I1 — ค่าปรับก่อน หักค่าปรับที่ใบก่อนของงวดลงไปแล้ว):
   * `installmentTotal` = `computeInstallmentBreakdown(accrual2AInputOf(...))` · ยอดที่ล้างแล้ว = `reconstructPriorCleared` — ท่อเดียวกับ
   * `PaymentJournalPreviewService` / `ContractPaymentService` · อ่านบัญชีเฉพาะงวดที่เงินปิดครบ มีค่าปรับ และเคยจ่ายบางส่วน (ค่าปรับที่ลงแล้วมีได้
   * เฉพาะงวดที่มีใบรับชำระ — งวดอื่น = 0) · ไม่มีแถวตารางงวด = 0 (webhook จะสร้างให้ ไม่มีรายการเดิม)
   */
  private async allocationPreview(
    contract: Accrual2AContractFields & { id: string },
    amount: Prisma.Decimal,
  ): Promise<LiffPayAllocationLine[]> {
    const allocation = allocatePaidAmountFifo(
      await this.prisma.payment.findMany(fifoUnpaidPaymentsArgs(contract.id)),
      amount,
    );
    const toRead = allocation.lines
      .filter((l) => l.fullyPaid && l.lateFee.gt(0) && l.payment.amountPaid.gt(0))
      .map((l) => l.payment.installmentNo);
    const scheduleIdOf = new Map<number, string>();
    if (toRead.length > 0) {
      const schedules = await this.prisma.installmentSchedule.findMany({
        where: { contractId: contract.id, installmentNo: { in: toRead }, deletedAt: null },
        select: { id: true, installmentNo: true },
      });
      for (const sched of schedules) scheduleIdOf.set(sched.installmentNo, sched.id);
    }

    const ledger = new Map<number, InstallmentLedgerSoFar>();
    for (const line of allocation.lines) {
      if (!line.fullyPaid) continue;
      const no = line.payment.installmentNo;
      const { installmentTotal } = computeInstallmentBreakdown(accrual2AInputOf(contract, no));
      const scheduleId = scheduleIdOf.get(no);
      const prior = scheduleId
        ? await reconstructPriorCleared(this.prisma, scheduleId, installmentTotal)
        : null;
      ledger.set(no, {
        installmentTotal,
        priorPrincipalCleared: prior?.priorPrincipalCleared ?? new Prisma.Decimal(0),
        priorLateFeeBooked: prior?.priorLateFeeBooked ?? new Prisma.Decimal(0),
      });
    }
    return payAllocationPreviewLines(allocation, (no) => ledger.get(no)!);
  }

  /**
   * Send payment link as Flex Card via LINE Finance — picks
   * `paymentReminder` (orange) or `overdueNotice` (red) based on whether
   * the contract has past-due unpaid installments. Persists a pipe-encoded
   * meta message in the staff chat room for inbox preview.
   */
  async sendPaymentFlex(body: { contractId: string }, req: { user: { id: string } }) {
    if (!body?.contractId) {
      throw new BadRequestException('กรุณาระบุสัญญา');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: body.contractId, deletedAt: null },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            lineLinks: {
              where: { channel: LineChannelType.FINANCE, unlinkedAt: null, deletedAt: null },
              select: { lineUserId: true },
              take: 1,
            },
          },
        },
        payments: {
          where: { status: { not: 'PAID' }, deletedAt: null },
          orderBy: { installmentNo: 'asc' },
        },
      },
    });

    if (!contract) {
      throw new NotFoundException('ไม่พบสัญญา');
    }

    const financeLineId = contract.customer.lineLinks[0]?.lineUserId;
    if (!financeLineId) {
      throw new BadRequestException('ลูกค้ายังไม่ผูก LINE การเงิน — ไม่สามารถส่ง Flex ได้');
    }

    if (contract.payments.length === 0) {
      throw new BadRequestException('สัญญานี้ชำระครบแล้ว');
    }

    // Task 34 รีวิว I1 — การ์ดนี้คือเตือนค่างวด / แจ้งค้างชำระที่พนักงานกดส่งเอง ⇒ ด่านความยินยอม PDPA นิยามเดียวกับทางเตือน/ทวงอื่น
    // (ข้อยกเว้นส่งด้วยมือ #18 = ช่วงผ่อนผันเท่านั้น) · ถามก่อนสร้างลิงก์ (ไม่มีแถวลิงก์ทิ้ง) · ทางที่ทำได้ = โทรออกจากเมนู "ดำเนินการ" เดียวกัน
    if (!(await hasActivePdpaConsent(this.prisma, contract.customer.id))) {
      throw new BadRequestException(NOT_SENT_REASON_TEXT.NO_CONSENT);
    }

    // Determine overdue
    const now = new Date();
    const overduePayments = contract.payments.filter((p) => p.dueDate && new Date(p.dueDate) < now);
    const isOverdue = overduePayments.length > 0;

    // Create payment link
    const linkResult = await this.createPaymentLink(body.contractId);

    // Build flex + capture meta for inbox preview
    const totalInstallments = await this.prisma.payment.count({
      where: { contractId: contract.id, deletedAt: null },
    });
    const lateFeeTotal = overduePayments.reduce((sum, p) => sum + d(p.lateFee), 0);
    const firstPayment = contract.payments[0];

    const flex = isOverdue
      ? this.flexTemplates.overdueNotice({
          contractNumber: contract.contractNumber,
          overdueInstallments: overduePayments.length,
          totalAmount: linkResult.amount,
          lateFee: lateFeeTotal,
          paymentUrl: linkResult.url,
        })
      : this.flexTemplates.paymentReminder({
          contractNumber: contract.contractNumber,
          installmentNo: firstPayment.installmentNo,
          amount: linkResult.amount,
          dueDate: formatDateShort(firstPayment.dueDate),
          paymentUrl: linkResult.url,
        });

    // Push via LINE Finance
    try {
      await this.lineFinanceClient.pushMessage(financeLineId, [flex as never]);
    } catch (err) {
      this.logger.error(`[payment-flex] push failed: ${err}`);
      throw new BadRequestException('ส่ง Flex ไม่สำเร็จ — กรุณาลองใหม่');
    }

    // Save record in chat room so staff sees it in history — ห้องของผู้รับจริง (LINE ของแถว OTP) ไม่ใช่ "ห้องการเงินล่าสุดของลูกค้า":
    // ห้องของ LINE ที่ลูกค้ายกเลิกแล้วยังถือ customerId เดิม (M-8) ⇒ บิลจะไปโผล่ในห้องนั้นและพนักงานตอบถึงผู้ถือ LINE เก่า (Task 24 fix round 2 m-2)
    const room = await this.prisma.chatRoom.findFirst({
      where: { lineUserId: financeLineId, channel: ChatChannel.LINE_FINANCE, deletedAt: null },
      select: { id: true },
    });

    if (room) {
      // Pipe-encoded meta so inbox can render a preview card matching the LINE Flex
      // Format (reminder): [flex:payment-reminder|<contractNo>|<installmentNo>/<total>|<amount>|<dueDate>|<daysUntilDue>] <url>
      // Format (overdue):  [flex:overdue-notice|<contractNo>|<overdueCount>|<amount>|<lateFee>|<oldestDueDate>] <url>
      const metaText = isOverdue
        ? (() => {
            const oldest = overduePayments[0];
            const oldestDue = oldest?.dueDate ? formatDateShort(oldest.dueDate) : '';
            return `[flex:overdue-notice|${contract.contractNumber}|${overduePayments.length}|${linkResult.amount}|${lateFeeTotal}|${oldestDue}] ${linkResult.url}`;
          })()
        : (() => {
            const dueDateStr = formatDateShort(firstPayment.dueDate);
            const daysUntilDue = firstPayment.dueDate
              ? Math.ceil((new Date(firstPayment.dueDate).getTime() - now.getTime()) / 86400000)
              : 0;
            return `[flex:payment-reminder|${contract.contractNumber}|${firstPayment.installmentNo}/${totalInstallments}|${linkResult.amount}|${dueDateStr}|${daysUntilDue}] ${linkResult.url}`;
          })();

      await this.prisma.chatMessage.create({
        data: {
          roomId: room.id,
          role: MessageRole.STAFF,
          type: MessageType.TEXT,
          text: metaText,
          staffId: req.user.id,
        },
      });
      await this.prisma.chatRoom.update({
        where: { id: room.id },
        data: { lastMessageAt: new Date(), totalMessages: { increment: 1 } },
      });
    }

    return {
      success: true,
      type: isOverdue ? 'overdue' : 'reminder',
      url: linkResult.url,
    };
  }
}
