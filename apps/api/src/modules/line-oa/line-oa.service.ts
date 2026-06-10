import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import type { LineChannelKey } from '../notifications/dto/create-notification.dto';
import { LineMessagePayload } from './dto/webhook-event.dto';
import { FlexMessagePayload } from './flex-messages/base-template';
import { PaymentSuccessData } from './flex-messages/payment-success.flex';
import { BalanceSummaryData } from './flex-messages/balance-summary.flex';
import { PaymentReminderData } from './flex-messages/payment-reminder.flex';
import { OverdueNoticeData } from './flex-messages/overdue-notice.flex';
import { PromptPayQrData } from './flex-messages/promptpay-qr.flex';
import { ReceiptHistoryData } from './flex-messages/receipt-history.flex';
import { ContractOption } from './flex-messages/contract-selector.flex';
import { ReceiptData } from './flex-messages/receipt.flex';
import { CampaignSendDto } from './dto/campaign-send.dto';
import { LineApiClientService } from './services/line-api-client.service';
import { LineCustomerLinkService } from './services/line-customer-link.service';
import { LineFlexBuilderService } from './services/line-flex-builder.service';
import { LineCampaignService } from './services/line-campaign.service';

@Injectable()
export class LineOaService {
  private readonly apiClient: LineApiClientService;
  private readonly customerLink: LineCustomerLinkService;
  private readonly flexBuilder: LineFlexBuilderService;
  private readonly campaign: LineCampaignService;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private pdpaService: PDPAService,
    private integrationConfig: IntegrationConfigService,
  ) {
    this.apiClient = new LineApiClientService(this.configService, this.integrationConfig);
    this.customerLink = new LineCustomerLinkService(this.prisma, this.apiClient);
    this.flexBuilder = new LineFlexBuilderService(
      this.prisma,
      this.pdpaService,
      this.configService,
      this.apiClient,
    );
    this.campaign = new LineCampaignService(this.prisma, this.apiClient);
  }

  // ─── LineApiClientService delegations ─────────────────

  testConnection(
    channelKey: LineChannelKey,
  ): Promise<{ displayName: string; userId: string; pictureUrl?: string }> {
    return this.apiClient.testConnection(channelKey);
  }

  pushMessage(
    to: string,
    messages: LineMessagePayload[],
    channelKey: LineChannelKey,
  ): Promise<void> {
    return this.apiClient.pushMessage(to, messages, channelKey);
  }

  replyMessage(
    replyToken: string,
    messages: LineMessagePayload[],
    channelKey: LineChannelKey,
  ): Promise<void> {
    return this.apiClient.replyMessage(replyToken, messages, channelKey);
  }

  sendFlexMessage(
    to: string,
    flexMessage: FlexMessagePayload,
    channelKey: LineChannelKey,
  ): Promise<void> {
    return this.apiClient.sendFlexMessage(to, flexMessage, channelKey);
  }

  downloadContent(
    messageId: string,
    channelKey: LineChannelKey,
  ): Promise<Buffer> {
    return this.apiClient.downloadContent(messageId, channelKey);
  }

  getUserProfile(
    userId: string,
    channelKey: LineChannelKey,
  ): Promise<{ displayName: string; pictureUrl?: string; statusMessage?: string }> {
    return this.apiClient.getUserProfile(userId, channelKey);
  }

  // ─── LineCustomerLinkService delegations ──────────────

  linkLineId(lineUserId: string): Promise<void> {
    return this.customerLink.linkLineId(lineUserId);
  }

  selfLinkByPhone(lineUserId: string, phone: string): Promise<{ success: boolean; customerName?: string }> {
    return this.customerLink.selfLinkByPhone(lineUserId, phone);
  }

  unlinkLineId(lineUserId: string): Promise<void> {
    return this.customerLink.unlinkLineId(lineUserId);
  }

  findCustomerByLineId(lineUserId: string) {
    return this.customerLink.findCustomerByLineId(lineUserId);
  }

  findBranchForCustomer(lineUserId: string) {
    return this.customerLink.findBranchForCustomer(lineUserId);
  }

  getLineStats() {
    return this.customerLink.getLineStats();
  }

  // ─── LineFlexBuilderService delegations ───────────────

  buildPaymentSuccess(data: PaymentSuccessData): FlexMessagePayload {
    return this.flexBuilder.buildPaymentSuccess(data);
  }

  buildBalanceSummary(data: BalanceSummaryData): FlexMessagePayload {
    return this.flexBuilder.buildBalanceSummary(data);
  }

  buildPaymentReminder(data: PaymentReminderData): FlexMessagePayload {
    return this.flexBuilder.buildPaymentReminder(data);
  }

  buildOverdueNotice(data: OverdueNoticeData): FlexMessagePayload {
    return this.flexBuilder.buildOverdueNotice(data);
  }

  buildPromptPayQr(data: PromptPayQrData): FlexMessagePayload {
    return this.flexBuilder.buildPromptPayQr(data);
  }

  buildReceiptHistory(data: ReceiptHistoryData): FlexMessagePayload {
    return this.flexBuilder.buildReceiptHistory(data);
  }

  buildContractSelector(customerName: string, contracts: ContractOption[], action: string): FlexMessagePayload {
    return this.flexBuilder.buildContractSelector(customerName, contracts, action);
  }

  sendReceipt(
    lineUserId: string,
    receiptData: ReceiptData,
    channelKey: LineChannelKey,
  ): Promise<void> {
    return this.flexBuilder.sendReceipt(lineUserId, receiptData, channelKey);
  }

  sendPaymentReceipt(customerId: string, receipt: {
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
    return this.flexBuilder.sendPaymentReceipt(customerId, receipt);
  }

  // ─── LineCampaignService delegations ──────────────────

  sendCampaign(dto: CampaignSendDto): Promise<{ queued: number; sent: number; failed: number }> {
    return this.campaign.sendCampaign(dto);
  }

  getCampaignHistory(): Promise<
    Array<{
      date: string;
      targetGroup: string;
      messageType: string;
      sent: number;
      failed: number;
    }>
  > {
    return this.campaign.getCampaignHistory();
  }
}
