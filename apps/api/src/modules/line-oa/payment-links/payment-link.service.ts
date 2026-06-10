import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageRole, MessageType, ChatChannel, LineChannelType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { calcOutstanding, toNum as d } from '../../../utils/decimal.util';
import { maskThaiName } from '../../../utils/mask-name.util';
import { formatDateShort } from '../../../utils/thai-date.util';
import { PromptPayQrService } from '../promptpay/promptpay-qr.service';
import { FlexTemplatesService } from '../flex-templates.service';
import { LineFinanceClientService } from '../../chatbot-finance/services/line-finance-client.service';
import { randomBytes } from 'crypto';

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
   * Create a payment link for a specific contract/installment
   */
  async createPaymentLink(contractId: string, installmentNo?: number, overrideAmount?: number): Promise<{
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

    const amount = overrideAmount ?? calcOutstanding(payment);

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
        status: 'ACTIVE',
        expiresAt,
      },
    });

    const url = `${this.baseUrl}/pay/${token}`;

    this.logger.log(`Payment link created for contract ${contract.contractNumber} installment ${payment.installmentNo}`);

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
            customer: { select: { name: true, phone: true, lineIdFinance: true } },
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

    return {
      valid: true,
      token,
      amount,
      status: link.status,
      expiresAt: link.expiresAt,
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

    // Determine overdue
    const now = new Date();
    const overduePayments = contract.payments.filter(
      (p) => p.dueDate && new Date(p.dueDate) < now,
    );
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

    // Save record in chat room so staff sees it in history
    const room = await this.prisma.chatRoom.findFirst({
      where: {
        customerId: contract.customer.id,
        channel: ChatChannel.LINE_FINANCE,
        deletedAt: null,
      },
      orderBy: { lastMessageAt: 'desc' },
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
