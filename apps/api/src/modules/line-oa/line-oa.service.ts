import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { CHATBOT_RESPONSES } from './chatbot-system-prompt.constants';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { toNum } from '../../utils/decimal.util';
import { PDPAService } from '../pdpa/pdpa.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { LineMessagePayload } from './dto/webhook-event.dto';
import { FlexMessagePayload } from './flex-messages/base-template';
import { buildPaymentSuccessFlex, PaymentSuccessData } from './flex-messages/payment-success.flex';
import { buildBalanceSummaryFlex, BalanceSummaryData } from './flex-messages/balance-summary.flex';
import { buildPaymentReminderFlex, PaymentReminderData } from './flex-messages/payment-reminder.flex';
import { buildOverdueNoticeFlex, OverdueNoticeData } from './flex-messages/overdue-notice.flex';
import { buildPromptPayQrFlex, PromptPayQrData } from './flex-messages/promptpay-qr.flex';
import { buildReceiptHistory, ReceiptHistoryData } from './flex-messages/receipt-history.flex';
import { buildContractSelector, ContractOption } from './flex-messages/contract-selector.flex';
import { buildReceiptMessage, ReceiptData } from './flex-messages/receipt.flex';
import { buildPromotionFlex } from './flex-messages/campaign.flex';
import { buildThankYouFlex } from './flex-messages/campaign.flex';
import { buildNewProductFlex } from './flex-messages/campaign.flex';
import {
  CampaignSendDto,
  CampaignTargetGroup,
  CampaignMessageType,
  CampaignFlexTemplate,
} from './dto/campaign-send.dto';

@Injectable()
export class LineOaService {
  private readonly logger = new Logger(LineOaService.name);
  private readonly lineApiBaseUrl = 'https://api.line.me/v2/bot';
  private readonly lineDataApiBaseUrl = 'https://api-data.line.me/v2/bot';

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private pdpaService: PDPAService,
    private integrationConfig: IntegrationConfigService,
  ) {}

  /**
   * LineOaService is SHOP-only by design. FINANCE has its own client at
   * chatbot-finance/services/line-finance-client.service.ts which reads
   * the `line-finance` integration independently. If you need FINANCE LINE
   * messaging, use that service — do NOT generalize this one.
   */
  private async getShopChannelToken(): Promise<string> {
    return (await this.integrationConfig.getValue('line-shop', 'channelToken')) || '';
  }

  async testConnection(): Promise<{ displayName: string; userId: string; pictureUrl?: string }> {
    const token = await this.getShopChannelToken();
    if (!token) {
      throw new BadRequestException('LINE Channel Access Token ยังไม่ได้ตั้งค่า');
    }

    const response = await fetch(`${this.lineApiBaseUrl}/info`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InternalServerErrorException(`LINE API error ${response.status}: ${errorBody}`);
    }

    return response.json();
  }

  // ─── LINE API Methods ─────────────────────────────────

  /**
   * Send push message(s) to a user
   */
  async pushMessage(to: string, messages: LineMessagePayload[]): Promise<void> {
    await this.callLineApi(`${this.lineApiBaseUrl}/message/push`, {
      to,
      messages,
    });
    this.logger.log(`[LINE] Push message sent to ${to}`);
  }

  /**
   * Reply to a message using reply token
   */
  async replyMessage(replyToken: string, messages: LineMessagePayload[]): Promise<void> {
    await this.callLineApi(`${this.lineApiBaseUrl}/message/reply`, {
      replyToken,
      messages,
    });
    this.logger.log(`[LINE] Reply message sent`);
  }

  /**
   * Send a Flex Message via push
   */
  async sendFlexMessage(to: string, flexMessage: FlexMessagePayload): Promise<void> {
    await this.pushMessage(to, [flexMessage as unknown as LineMessagePayload]);
  }

  /**
   * Download content (image, video, etc.) from LINE
   */
  async downloadContent(messageId: string): Promise<Buffer> {
    const token = await this.getShopChannelToken();
    if (!token) {
      throw new BadRequestException('LINE channel access token not configured');
    }

    const url = `${this.lineDataApiBaseUrl}/message/${messageId}/content`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(`Failed to download LINE content: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId: string): Promise<{ displayName: string; pictureUrl?: string; statusMessage?: string }> {
    const token = await this.getShopChannelToken();
    if (!token) {
      throw new BadRequestException('LINE channel access token not configured');
    }

    const url = `${this.lineApiBaseUrl}/profile/${userId}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(`Failed to get LINE profile: ${response.status}`);
    }

    return response.json();
  }

  // ─── Customer Management ──────────────────────────────

  /**
   * Link a LINE user ID to a customer (on follow event)
   */
  async linkLineId(lineUserId: string): Promise<void> {
    // Try to find existing customer with this lineId
    const existing = await this.prisma.customer.findFirst({
      where: { lineId: lineUserId, deletedAt: null },
    });

    if (existing) {
      this.logger.log(`[LINE] Customer ${existing.name} already linked with LINE ID`);
      return;
    }

    this.logger.log(`[LINE] New follow from ${lineUserId} - sending welcome message`);
    try {
      await this.pushMessage(lineUserId, [
        {
          type: 'text',
          text: CHATBOT_RESPONSES.welcomeFollow,
        } as unknown as LineMessagePayload,
      ]);
    } catch (err) {
      this.logger.warn(`[LINE] Failed to send welcome message: ${err}`);
    }
  }

  /**
   * Self-link: customer sends phone number to link their LINE account
   */
  async selfLinkByPhone(lineUserId: string, phone: string): Promise<{ success: boolean; customerName?: string }> {
    // Check if already linked
    const alreadyLinked = await this.prisma.customer.findFirst({
      where: { lineId: lineUserId, deletedAt: null },
    });
    if (alreadyLinked) {
      return { success: true, customerName: alreadyLinked.name };
    }

    // Find customer by phone
    const customer = await this.prisma.customer.findFirst({
      where: { phone, deletedAt: null, lineId: null },
    });

    if (!customer) {
      return { success: false };
    }

    // Link
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { lineId: lineUserId },
    });

    this.logger.log(`[LINE] Self-linked ${lineUserId} to customer ${customer.name} via phone ${phone}`);
    return { success: true, customerName: customer.name };
  }

  /**
   * Unlink a LINE user ID from a customer (on unfollow event)
   */
  async unlinkLineId(lineUserId: string): Promise<void> {
    await this.prisma.customer.updateMany({
      where: { lineId: lineUserId, deletedAt: null },
      data: { lineId: null },
    });
    this.logger.log(`[LINE] Unlinked LINE ID ${lineUserId}`);
  }

  /**
   * Find customer by LINE user ID, including active contracts and payments
   */
  async findCustomerByLineId(lineUserId: string) {
    return this.prisma.customer.findFirst({
      where: { lineId: lineUserId, deletedAt: null },
      include: {
        contracts: {
          where: {
            status: { in: ['ACTIVE', 'OVERDUE'] },
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          include: {
            payments: {
              orderBy: { installmentNo: 'asc' },
            },
          },
        },
      },
    });
  }

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
  async sendReceipt(lineUserId: string, receiptData: ReceiptData): Promise<void> {
    const flexMessage = buildReceiptMessage(receiptData);
    await this.sendFlexMessage(lineUserId, flexMessage);
    this.logger.log(`[LINE] Receipt ${receiptData.receiptNumber} sent to ${lineUserId}`);
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
          lineId: { not: null },
          deletedAt: null
        },
        select: {
          lineId: true,
          name: true
        }
      });

      if (!customer?.lineId) {
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

      // Send receipt via LINE
      await this.sendReceipt(customer.lineId, receiptData);

      // Log notification
      await this.prisma.notificationLog.create({
        data: {
          channel: 'LINE',
          recipient: customer.lineId,
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

  // ─── Branch Contact ─────────────────────────────────

  async findBranchForCustomer(lineUserId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { lineId: lineUserId, deletedAt: null },
      include: {
        contracts: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { branch: { select: { name: true, phone: true, location: true } } },
        },
      },
    });

    if (customer?.contracts?.[0]?.branch) {
      return customer.contracts[0].branch;
    }

    // Fallback to main warehouse branch
    return this.prisma.branch.findFirst({
      where: { isMainWarehouse: true, isActive: true, deletedAt: null },
      select: { name: true, phone: true, location: true },
    });
  }

  // ─── Statistics ─────────────────────────────────────

  async getLineStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [linkedCustomers, pendingSlips, todayNotifications] = await Promise.all([
      this.prisma.customer.count({ where: { lineId: { not: null }, deletedAt: null } }),
      this.prisma.paymentEvidence.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.notificationLog.count({ where: { channel: 'LINE', sentAt: { gte: today } } }),
    ]);

    return { linkedCustomers, pendingSlips, todayNotifications };
  }

  // ─── LIFF API Methods ──────────────────────────────────

  /**
   * Find customer with full contract details (for LIFF contract page)
   */
  // ─── Campaign Methods ─────────────────────────────────

  /**
   * Send a bulk LINE campaign to a target group of customers.
   * Fire-and-forget: validates input, then sends asynchronously.
   */
  async sendCampaign(dto: CampaignSendDto): Promise<{ queued: number; sent: number; failed: number }> {
    // Validate: text messages require message body, flex requires template
    if (dto.messageType === CampaignMessageType.TEXT && !dto.message) {
      throw new BadRequestException('กรุณาระบุข้อความสำหรับ text message');
    }
    if (dto.messageType === CampaignMessageType.FLEX && !dto.flexTemplate) {
      throw new BadRequestException('กรุณาเลือก Flex template');
    }

    // Query target customers with lineId
    const customers = await this.getCampaignTargetCustomers(dto.targetGroup);
    if (customers.length === 0) {
      return { queued: 0, sent: 0, failed: 0 };
    }

    // Build message payload
    const buildMessage = (customerName: string): LineMessagePayload[] | FlexMessagePayload => {
      if (dto.messageType === CampaignMessageType.TEXT) {
        return [{ type: 'text', text: dto.message! }] as LineMessagePayload[];
      }

      // Flex message
      switch (dto.flexTemplate) {
        case CampaignFlexTemplate.PROMOTION:
          return buildPromotionFlex({
            title: dto.customData?.title || 'โปรโมชั่นพิเศษ',
            subtitle: dto.customData?.subtitle || 'จาก BEST CHOICE',
            imageUrl: dto.customData?.imageUrl,
            ctaUrl: dto.customData?.ctaUrl,
          });
        case CampaignFlexTemplate.THANK_YOU:
          return buildThankYouFlex({
            customerName,
            message: dto.message,
          });
        case CampaignFlexTemplate.NEW_PRODUCT:
          return buildNewProductFlex({
            productName: dto.customData?.title || 'สินค้าใหม่',
            imageUrl: dto.customData?.imageUrl,
            price: dto.customData?.price,
            ctaUrl: dto.customData?.ctaUrl,
          });
        default:
          throw new BadRequestException(`ไม่รู้จัก flex template: ${dto.flexTemplate}`);
      }
    };

    // Send in batches of 50 with 1s delay — fire-and-forget
    const result = { sent: 0, failed: 0 };
    const batchSize = 50;

    // Execute sending asynchronously (don't block the request)
    this.executeCampaignSend(customers, buildMessage, dto, batchSize, result).catch((err) => {
      this.logger.error(`[Campaign] Async send failed: ${err}`);
    });

    // Return immediately — sending happens asynchronously
    return { queued: customers.length, sent: 0, failed: 0 };
  }

  /**
   * Execute campaign sending in batches (runs asynchronously)
   */
  private async executeCampaignSend(
    customers: Array<{ lineId: string; name: string }>,
    buildMessage: (customerName: string) => LineMessagePayload[] | FlexMessagePayload,
    dto: CampaignSendDto,
    batchSize: number,
    _result: { sent: number; failed: number },
  ): Promise<void> {
    let totalSent = 0;
    let totalFailed = 0;
    const campaignId = `campaign-${Date.now()}`;

    for (let i = 0; i < customers.length; i += batchSize) {
      const batch = customers.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (customer) => {
          try {
            const msg = buildMessage(customer.name);

            if (dto.messageType === CampaignMessageType.TEXT) {
              await this.pushMessage(customer.lineId, msg as LineMessagePayload[]);
            } else {
              await this.sendFlexMessage(customer.lineId, msg as FlexMessagePayload);
            }

            // Log success
            await this.prisma.notificationLog.create({
              data: {
                channel: 'LINE',
                recipient: customer.lineId,
                subject: `campaign:${dto.targetGroup}:${dto.flexTemplate || 'text'}`,
                message: dto.message || `campaign flex: ${dto.flexTemplate}`,
                status: 'SENT',
                sentAt: new Date(),
                relatedId: campaignId,
              },
            });

            return 'sent';
          } catch (err) {
            // Log failure
            await this.prisma.notificationLog.create({
              data: {
                channel: 'LINE',
                recipient: customer.lineId,
                subject: `campaign:${dto.targetGroup}:${dto.flexTemplate || 'text'}`,
                message: dto.message || `campaign flex: ${dto.flexTemplate}`,
                status: 'FAILED',
                errorMsg: err instanceof Error ? err.message : String(err),
                sentAt: new Date(),
                relatedId: campaignId,
              },
            });

            return 'failed';
          }
        }),
      );

      let rateLimitedSeconds = 0;
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value === 'sent') totalSent++;
        else totalFailed++;
        // (Audit finding W6) Detect 429 Retry-After surfaced by callLineApi.
        // If any item in the batch was rate-limited, sleep at least the
        // requested interval before the next batch instead of barrelling
        // through with the fixed 1s gap.
        if (r.status === 'rejected' && r.reason instanceof Error) {
          const m = r.reason.message?.match(/429.*retry after (\d+)s/i);
          if (m) {
            const sec = Number.parseInt(m[1], 10);
            if (sec > rateLimitedSeconds) rateLimitedSeconds = sec;
          }
        }
      }

      // Wait between batches — honour LINE Retry-After if seen, else 1s default.
      if (i + batchSize < customers.length) {
        const waitMs = Math.max(rateLimitedSeconds * 1000, 1000);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    this.logger.log(
      `[Campaign] Completed: sent=${totalSent}, failed=${totalFailed}, target=${dto.targetGroup}`,
    );
  }

  /**
   * Query customers matching the campaign target group who have lineId
   */
  private async getCampaignTargetCustomers(
    targetGroup: CampaignTargetGroup,
  ): Promise<Array<{ lineId: string; name: string }>> {
    switch (targetGroup) {
      case CampaignTargetGroup.ALL: {
        const customers = await this.prisma.customer.findMany({
          where: { lineId: { not: null }, deletedAt: null, pdpaConsents: { some: { status: 'GRANTED', deletedAt: null } } },
          select: { lineId: true, name: true },
        });
        return customers.filter((c): c is { lineId: string; name: string } => c.lineId !== null);
      }

      case CampaignTargetGroup.ACTIVE: {
        const customers = await this.prisma.customer.findMany({
          where: {
            lineId: { not: null },
            deletedAt: null,
            pdpaConsents: { some: { status: 'GRANTED', deletedAt: null } },
            contracts: {
              some: { status: 'ACTIVE', deletedAt: null },
            },
          },
          select: { lineId: true, name: true },
        });
        return customers.filter((c): c is { lineId: string; name: string } => c.lineId !== null);
      }

      case CampaignTargetGroup.OVERDUE: {
        const customers = await this.prisma.customer.findMany({
          where: {
            lineId: { not: null },
            deletedAt: null,
            pdpaConsents: { some: { status: 'GRANTED', deletedAt: null } },
            contracts: {
              some: { status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null },
            },
          },
          select: { lineId: true, name: true },
        });
        return customers.filter((c): c is { lineId: string; name: string } => c.lineId !== null);
      }

      case CampaignTargetGroup.COMPLETED: {
        // Customers who have all contracts completed (loyalty group)
        const customers = await this.prisma.customer.findMany({
          where: {
            lineId: { not: null },
            deletedAt: null,
            pdpaConsents: { some: { status: 'GRANTED', deletedAt: null } },
            contracts: {
              some: { deletedAt: null },
            },
          },
          select: {
            lineId: true,
            name: true,
            contracts: {
              where: { deletedAt: null },
              select: { status: true },
            },
          },
        });

        return customers
          .filter((c) => {
            // All contracts must be COMPLETED or EARLY_PAYOFF
            return (
              c.lineId !== null &&
              c.contracts.length > 0 &&
              c.contracts.every((con) =>
                ['COMPLETED', 'EARLY_PAYOFF'].includes(con.status),
              )
            );
          })
          .map((c) => ({ lineId: c.lineId!, name: c.name }));
      }

      default:
        return [];
    }
  }

  /**
   * Get campaign history from NotificationLog
   */
  async getCampaignHistory(): Promise<
    Array<{
      date: string;
      targetGroup: string;
      messageType: string;
      sent: number;
      failed: number;
    }>
  > {
    const logs = await this.prisma.notificationLog.findMany({
      where: {
        channel: 'LINE',
        subject: { startsWith: 'campaign:' },
        deletedAt: null,
      },
      orderBy: { sentAt: 'desc' },
      take: 1000,
    });

    // Group by relatedId (campaign batch)
    const campaignMap = new Map<
      string,
      {
        date: string;
        targetGroup: string;
        messageType: string;
        sent: number;
        failed: number;
      }
    >();

    for (const log of logs) {
      const key = log.relatedId || log.id;
      const existing = campaignMap.get(key);

      // Parse subject: "campaign:ALL:promotion"
      const parts = (log.subject || '').split(':');
      const targetGroup = parts[1] || 'UNKNOWN';
      const messageType = parts[2] || 'text';
      const date = log.sentAt
        ? log.sentAt.toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      if (existing) {
        if (log.status === 'SENT') existing.sent++;
        else existing.failed++;
      } else {
        campaignMap.set(key, {
          date,
          targetGroup,
          messageType,
          sent: log.status === 'SENT' ? 1 : 0,
          failed: log.status === 'FAILED' ? 1 : 0,
        });
      }
    }

    return Array.from(campaignMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  }

  // ─── Private Helpers ──────────────────────────────────

  private async callLineApi(url: string, body: unknown): Promise<void> {
    const token = await this.getShopChannelToken();
    if (!token) {
      throw new BadRequestException('LINE channel access token not configured');
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        // (Audit finding W6) LINE returns 429 Too Many Requests with a
        // Retry-After header (seconds) when the per-recipient burst limit
        // is hit. Surface that to callers so the campaign batch loop can
        // sleep the requested interval instead of slamming the next
        // batch one second later — without this, every retry inside the
        // throttled window also fails.
        if (response.status === 429) {
          const retryAfterRaw = response.headers.get('retry-after');
          const retryAfter = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : 0;
          throw new InternalServerErrorException(
            `LINE API 429 rate limit; retry after ${retryAfter || 60}s`,
          );
        }
        const errorBody = await response.text();
        throw new InternalServerErrorException(`LINE API error ${response.status}: ${errorBody}`);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        this.logger.error(`[LINE SHOP] API timeout after 10s: ${url}`);
        Sentry.captureException(err, {
          tags: { module: 'line-shop', action: 'line_api', reason: 'timeout' },
          extra: { url },
        });
        throw new InternalServerErrorException('LINE API timeout');
      }
      throw err;
    }
  }
}
