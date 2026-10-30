import { Injectable, Logger } from '@nestjs/common';
import { CHATBOT_RESPONSES } from '../chatbot-system-prompt.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineMessagePayload } from '../dto/webhook-event.dto';
import { LineApiClientService } from './line-api-client.service';
import { findOtpVerifiedCustomerId } from './otp-verified-customer';

/**
 * ตัวตนลูกค้าของ OA ร้าน (SHOP).
 *
 * Task 20 C1 — ไม่มีทางผูก `customers.line_id_shop` ด้วยเบอร์อย่างเดียวอีกแล้ว (เดิม `selfLinkByPhone`:
 * ใครพิมพ์เบอร์ในแชทก็ผูก LINE ตัวเองกับเจ้าของเบอร์ แล้วบอทตอบชื่อเต็ม + ยอด/งวด/ใบเสร็จของคนนั้น).
 * การอ่านข้อมูลลูกค้าเพื่อตอบในแชทใช้ `findVerifiedCustomerByLineId` (แถว link FINANCE จาก OTP) เท่านั้น.
 */
@Injectable()
export class LineCustomerLinkService {
  private readonly logger = new Logger(LineCustomerLinkService.name);

  constructor(
    private prisma: PrismaService,
    private apiClient: LineApiClientService,
  ) {}

  // ─── Customer Management ──────────────────────────────

  /**
   * Link a LINE user ID to a customer (on follow event)
   */
  async linkLineId(lineUserId: string): Promise<void> {
    // Try to find existing customer with this lineIdShop
    const existing = await this.prisma.customer.findFirst({
      where: { lineIdShop: lineUserId, deletedAt: null },
    });

    if (existing) {
      this.logger.log(`[LINE] Customer ${existing.name} already linked with LINE ID`);
      return;
    }

    this.logger.log(`[LINE] New follow from ${lineUserId} - sending welcome message`);
    try {
      await this.apiClient.pushMessage(
        lineUserId,
        [
          {
            type: 'text',
            text: CHATBOT_RESPONSES.welcomeFollow,
          } as unknown as LineMessagePayload,
        ],
        'line-shop',
      );
    } catch (err) {
      this.logger.warn(`[LINE] Failed to send welcome message: ${err}`);
    }
  }

  /**
   * Unlink a LINE user ID from a customer (on unfollow event)
   */
  async unlinkLineId(lineUserId: string): Promise<void> {
    await this.prisma.customer.updateMany({
      where: { lineIdShop: lineUserId, deletedAt: null },
      data: { lineIdShop: null },
    });
    this.logger.log(`[LINE] Unlinked LINE ID ${lineUserId}`);
  }

  /**
   * ลูกค้าที่ LINE นี้ยืนยัน OTP แล้ว (แถว link FINANCE ที่ยังผูก) + สัญญา ACTIVE/OVERDUE + งวด —
   * null = ยังไม่ยืนยัน ⇒ ห้ามตอบชื่อ/สัญญา/ยอด (Task 20 C1)
   */
  async findVerifiedCustomerByLineId(lineUserId: string) {
    const customerId = await findOtpVerifiedCustomerId(this.prisma, lineUserId);
    if (!customerId) return null;
    return this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
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

  // ─── Branch Contact ─────────────────────────────────

  /** สาขาของสัญญาล่าสุด — เฉพาะลูกค้าที่ยืนยัน OTP แล้ว (สาขาของสัญญาบอกว่าคนนี้ซื้อที่ไหน) */
  async findBranchForCustomer(lineUserId: string) {
    const customerId = await findOtpVerifiedCustomerId(this.prisma, lineUserId);
    const customer = customerId
      ? await this.prisma.customer.findFirst({
          where: { id: customerId, deletedAt: null },
          include: {
            contracts: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { branch: { select: { name: true, phone: true, location: true } } },
            },
          },
        })
      : null;

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
      this.prisma.customer.count({ where: { lineIdShop: { not: null }, deletedAt: null } }),
      this.prisma.paymentEvidence.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.notificationLog.count({ where: { channel: 'LINE', sentAt: { gte: today } } }),
    ]);

    return { linkedCustomers, pendingSlips, todayNotifications };
  }
}
