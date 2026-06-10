import { Injectable, Logger } from '@nestjs/common';
import { CHATBOT_RESPONSES } from '../chatbot-system-prompt.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineMessagePayload } from '../dto/webhook-event.dto';
import { LineApiClientService } from './line-api-client.service';

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
   * Self-link: customer sends phone number to link their LINE account
   */
  async selfLinkByPhone(lineUserId: string, phone: string): Promise<{ success: boolean; customerName?: string }> {
    // Check if already linked
    const alreadyLinked = await this.prisma.customer.findFirst({
      where: { lineIdShop: lineUserId, deletedAt: null },
    });
    if (alreadyLinked) {
      return { success: true, customerName: alreadyLinked.name };
    }

    // Find customer by phone
    const customer = await this.prisma.customer.findFirst({
      where: { phone, deletedAt: null, lineIdShop: null },
    });

    if (!customer) {
      return { success: false };
    }

    // Link
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { lineIdShop: lineUserId },
    });

    this.logger.log(`[LINE] Self-linked ${lineUserId} to customer ${customer.name} via phone ${phone}`);
    return { success: true, customerName: customer.name };
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
   * Find customer by LINE user ID, including active contracts and payments
   */
  async findCustomerByLineId(lineUserId: string) {
    return this.prisma.customer.findFirst({
      where: { lineIdShop: lineUserId, deletedAt: null },
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

  async findBranchForCustomer(lineUserId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { lineIdShop: lineUserId, deletedAt: null },
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
      this.prisma.customer.count({ where: { lineIdShop: { not: null }, deletedAt: null } }),
      this.prisma.paymentEvidence.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.notificationLog.count({ where: { channel: 'LINE', sentAt: { gte: today } } }),
    ]);

    return { linkedCustomers, pendingSlips, todayNotifications };
  }
}
