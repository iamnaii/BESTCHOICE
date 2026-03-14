import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { LineMessagePayload } from './dto/webhook-event.dto';
import { FlexMessagePayload } from './flex-messages/base-template';
import { buildPaymentSuccessFlex, PaymentSuccessData } from './flex-messages/payment-success.flex';
import { buildBalanceSummaryFlex, BalanceSummaryData } from './flex-messages/balance-summary.flex';
import { buildPaymentReminderFlex, PaymentReminderData } from './flex-messages/payment-reminder.flex';
import { buildOverdueNoticeFlex, OverdueNoticeData } from './flex-messages/overdue-notice.flex';
import { buildPromptPayQrFlex, PromptPayQrData } from './flex-messages/promptpay-qr.flex';
import { buildReceiptHistory, ReceiptHistoryData } from './flex-messages/receipt-history.flex';
import { buildContractSelector, ContractOption } from './flex-messages/contract-selector.flex';

@Injectable()
export class LineOaService {
  private readonly logger = new Logger(LineOaService.name);
  private lineChannelAccessToken: string | undefined;
  private readonly lineApiBaseUrl = 'https://api.line.me/v2/bot';
  private readonly lineDataApiBaseUrl = 'https://api-data.line.me/v2/bot';

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.lineChannelAccessToken = this.configService.get<string>('LINE_CHANNEL_ACCESS_TOKEN');
    // Load from DB on startup (async)
    this.loadConfigFromDb();
  }

  private async loadConfigFromDb(): Promise<void> {
    try {
      const config = await this.prisma.systemConfig.findUnique({
        where: { key: 'line_channel_access_token' },
      });
      if (config?.value) {
        this.lineChannelAccessToken = config.value;
        this.logger.log('[LINE] Config loaded from database');
      }
    } catch {
      // DB might not be ready yet on startup, that's fine
    }
  }

  async reloadConfig(): Promise<void> {
    await this.loadConfigFromDb();
  }

  async testConnection(): Promise<{ displayName: string; userId: string; pictureUrl?: string }> {
    if (!this.lineChannelAccessToken) {
      throw new Error('LINE Channel Access Token ยังไม่ได้ตั้งค่า');
    }

    const response = await fetch(`${this.lineApiBaseUrl}/info`, {
      headers: { Authorization: `Bearer ${this.lineChannelAccessToken}` },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LINE API error ${response.status}: ${errorBody}`);
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
    if (!this.lineChannelAccessToken) {
      throw new Error('LINE channel access token not configured');
    }

    const url = `${this.lineDataApiBaseUrl}/message/${messageId}/content`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.lineChannelAccessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download LINE content: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId: string): Promise<{ displayName: string; pictureUrl?: string; statusMessage?: string }> {
    if (!this.lineChannelAccessToken) {
      throw new Error('LINE channel access token not configured');
    }

    const url = `${this.lineApiBaseUrl}/profile/${userId}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.lineChannelAccessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get LINE profile: ${response.status}`);
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
          text: 'สวัสดีค่ะ ยินดีต้อนรับสู่ BEST CHOICE 🎉\n\nกรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้ เพื่อเชื่อมบัญชีกับระบบค่ะ\n\nตัวอย่าง: 0812345678',
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
      where: { lineId: lineUserId },
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
      where: { isMainWarehouse: true, isActive: true },
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
  async findCustomerContractsFull(lineId: string) {
    return this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
      select: {
        id: true,
        name: true,
        contracts: {
          where: {
            status: { in: ['ACTIVE', 'OVERDUE', 'COMPLETED', 'EARLY_PAYOFF'] },
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            contractNumber: true,
            status: true,
            sellingPrice: true,
            downPayment: true,
            totalMonths: true,
            createdAt: true,
            product: {
              select: { name: true, brand: true, model: true },
            },
            payments: {
              orderBy: { installmentNo: 'asc' },
              select: {
                id: true,
                installmentNo: true,
                dueDate: true,
                amountDue: true,
                amountPaid: true,
                lateFee: true,
                status: true,
                paidDate: true,
                paymentMethod: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Lookup customer by phone for LIFF registration
   */
  async lookupCustomerByPhone(phone: string, lineId: string): Promise<{ customerId: string; maskedName: string } | null> {
    // Check if this lineId is already linked
    const alreadyLinked = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
    });
    if (alreadyLinked) {
      return null; // Already linked
    }

    // Find customer by phone (not already linked to another LINE)
    // Normalize: strip dashes/spaces so "0922222222" matches "092-222-2222"
    const digits = phone.replace(/\D/g, '');
    // Generate common Thai phone formats: 0922222222, 092-222-2222, 092-2222222
    const phoneVariants = [digits];
    if (digits.length === 10) {
      phoneVariants.push(`${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`);
      phoneVariants.push(`${digits.slice(0, 3)}-${digits.slice(3)}`);
    } else if (digits.length === 9) {
      phoneVariants.push(`${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`);
    }
    const customer = await this.prisma.customer.findFirst({
      where: {
        deletedAt: null,
        phone: { in: phoneVariants },
      },
    });

    if (!customer) return null;

    return {
      customerId: customer.id,
      maskedName: this.maskThaiName(customer.name),
    };
  }

  /**
   * Confirm LINE linking from LIFF registration
   */
  async confirmLinkLine(customerId: string, lineId: string): Promise<{ success: boolean; error?: string }> {
    // Check if lineId already linked to another customer
    const existingLink = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
    });
    if (existingLink) {
      return { success: false, error: 'บัญชี LINE นี้เชื่อมต่อกับลูกค้ารายอื่นแล้ว' };
    }

    // Check if customer exists and not already linked
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer || customer.deletedAt) {
      return { success: false, error: 'ไม่พบข้อมูลลูกค้า' };
    }
    if (customer.lineId && customer.lineId !== lineId) {
      return { success: false, error: 'ลูกค้ารายนี้เชื่อมต่อกับบัญชี LINE อื่นแล้ว' };
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { lineId },
    });

    this.logger.log(`[LIFF] Linked LINE ${lineId} to customer ${customer.name} via registration`);
    return { success: true };
  }

  /**
   * Check if a lineId is already linked to a customer
   */
  async isLineIdLinked(lineId: string): Promise<boolean> {
    const customer = await this.prisma.customer.findFirst({
      where: { lineId, deletedAt: null },
    });
    return !!customer;
  }

  /**
   * Mask a Thai name for privacy: "สมชาย จันทร์ดี" → "สม*** จั***"
   */
  maskThaiName(name: string): string {
    return name
      .split(' ')
      .map((part) => {
        if (part.length <= 2) return part + '***';
        return part.substring(0, 2) + '***';
      })
      .join(' ');
  }

  // ─── Private Helpers ──────────────────────────────────

  private async callLineApi(url: string, body: unknown): Promise<void> {
    if (!this.lineChannelAccessToken) {
      throw new Error('LINE channel access token not configured');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.lineChannelAccessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LINE API error ${response.status}: ${errorBody}`);
    }
  }
}
