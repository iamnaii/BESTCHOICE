import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { toNum } from '../../../utils/decimal.util';
import { PDPAService } from '../../pdpa/pdpa.service';
import type { LineChannelKey } from '../../notifications/dto/create-notification.dto';
import { FlexMessagePayload } from '../flex-messages/base-template';
import { PaymentSuccessData } from '../flex-messages/payment-success.flex';
import { buildPaymentSuccessFlex } from '../flex-messages/payment-success.flex';
import { buildBalanceSummaryFlex, BalanceSummaryData } from '../flex-messages/balance-summary.flex';
import { buildPaymentReminderFlex, PaymentReminderData } from '../flex-messages/payment-reminder.flex';
import { buildOverdueNoticeFlex, OverdueNoticeData } from '../flex-messages/overdue-notice.flex';
import { buildPromptPayQrFlex, PromptPayQrData } from '../flex-messages/promptpay-qr.flex';
import { buildReceiptHistory, ReceiptHistoryData } from '../flex-messages/receipt-history.flex';
import { buildContractSelector, ContractOption } from '../flex-messages/contract-selector.flex';
import { buildReceiptMessage, ReceiptData } from '../flex-messages/receipt.flex';
import { LineApiClientService } from './line-api-client.service';

@Injectable()
export class LineFlexBuilderService {
  private readonly logger = new Logger(LineFlexBuilderService.name);

  constructor(
    private prisma: PrismaService,
    private pdpaService: PDPAService,
    private configService: ConfigService,
    private apiClient: LineApiClientService,
  ) {}

  // ─── Flex Message Builders ────────────────────────────

  /**
   * Build payment success Flex Message
   */
  buildPaymentSuccess(data: PaymentSuccessData): FlexMessagePayload {
    return buildPaymentSuccessFlex(data);
  }

  /**
   * Build balance summary Flex Message
   */
  buildBalanceSummary(data: BalanceSummaryData): FlexMessagePayload {
    return buildBalanceSummaryFlex(data);
  }

  buildPaymentReminder(data: PaymentReminderData): FlexMessagePayload {
    return buildPaymentReminderFlex(data);
  }

  buildOverdueNotice(data: OverdueNoticeData): FlexMessagePayload {
    return buildOverdueNoticeFlex(data);
  }

  buildPromptPayQr(data: PromptPayQrData): FlexMessagePayload {
    return buildPromptPayQrFlex(data);
  }

  buildReceiptHistory(data: ReceiptHistoryData): FlexMessagePayload {
    return buildReceiptHistory(data);
  }

  buildContractSelector(customerName: string, contracts: ContractOption[], action: string): FlexMessagePayload {
    return buildContractSelector(customerName, contracts, action);
  }

  /**
   * Build and send receipt Flex Message
   */
  async sendReceipt(
    lineUserId: string,
    receiptData: ReceiptData,
    channelKey: LineChannelKey,
  ): Promise<void> {
    const flexMessage = buildReceiptMessage(receiptData);
    await this.apiClient.sendFlexMessage(lineUserId, flexMessage, channelKey);
    this.logger.log(`[LINE:${channelKey}] Receipt ${receiptData.receiptNumber} sent to ${lineUserId}`);
  }

  /**
   * Send receipt to customer after payment is recorded
   */
  async sendPaymentReceipt(customerId: string, receipt: {
    id: string;
    contractId: string;
    receiptNumber: string;
    receiptType: string;
    payerName: string;
    amount: { toString(): string } | number;
    installmentNo?: number | null;
    remainingBalance?: { toString(): string } | number | null;
    remainingMonths?: number | null;
    paymentMethod: string | null;
    paidDate: Date;
  }): Promise<boolean> {
    try {
      // Find customer with LINE ID
      const customer = await this.prisma.customer.findFirst({
        where: {
          id: customerId,
          lineIdShop: { not: null },
          deletedAt: null
        },
        select: {
          lineIdShop: true,
          name: true
        }
      });

      if (!customer?.lineIdShop) {
        this.logger.log('[LINE] Customer not linked to LINE, skipping receipt send');
        return false;
      }

      // Check PDPA consent before sending
      const hasConsent = await this.pdpaService.hasActiveConsent(customerId);
      if (!hasConsent) {
        this.logger.debug(`[LINE] PDPA consent not granted for customer ${customerId} — skipping payment receipt`);
        return false;
      }

      // Get contract and product details
      const contract = await this.prisma.contract.findUnique({
        where: { id: receipt.contractId },
        select: {
          contractNumber: true,
          product: {
            select: { name: true }
          }
        }
      });

      // Prepare receipt data for LINE Flex Message
      const receiptData: ReceiptData = {
        receiptNumber: receipt.receiptNumber,
        receiptType: receipt.receiptType,
        payerName: receipt.payerName,
        amount: toNum(receipt.amount),
        installmentNo: receipt.installmentNo ?? undefined,
        remainingBalance: receipt.remainingBalance ? toNum(receipt.remainingBalance) : undefined,
        remainingMonths: receipt.remainingMonths ?? undefined,
        paymentMethod: receipt.paymentMethod || 'CASH',
        paidDate: receipt.paidDate.toISOString(),
        productName: contract?.product?.name,
        contractNumber: contract?.contractNumber,
        verifyUrl: `${this.configService.get<string>('FRONTEND_URL') || 'https://bestchoice.com'}/verify/${receipt.receiptNumber}`
      };

      // Send receipt via LINE (SHOP receipt — sale completed at shop)
      await this.sendReceipt(customer.lineIdShop, receiptData, 'line-shop');

      // Log notification
      await this.prisma.notificationLog.create({
        data: {
          channel: 'LINE',
          recipient: customer.lineIdShop,
          message: `ใบเสร็จ #${receipt.receiptNumber}`,
          status: 'SENT',
          sentAt: new Date(),
          relatedId: receipt.id
        }
      });

      return true;
    } catch (error) {
      this.logger.error(`[LINE] Failed to send receipt: ${error}`);
      return false;
    }
  }
}
