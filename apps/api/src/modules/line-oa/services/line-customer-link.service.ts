import { Injectable, Logger, Optional } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { CHATBOT_RESPONSES } from '../chatbot-system-prompt.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineMessagePayload } from '../dto/webhook-event.dto';
import { LineApiClientService } from './line-api-client.service';
import { CustomerMergeService, SYSTEM_ACTOR } from '../../chat-prospects/customer-merge.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { lineLinkedEntry } from '../../customer-journey/chat-identity-entries';

@Injectable()
export class LineCustomerLinkService {
  private readonly logger = new Logger(LineCustomerLinkService.name);

  constructor(
    private prisma: PrismaService,
    private apiClient: LineApiClientService,
    @Optional() private merge?: CustomerMergeService,
    // การเดินทางของลูกค้า — LINE_LINKED (lineIdShop ไม่มีคอลัมน์เวลาผูก)
    @Optional() private journey?: JourneyEntryWriter,
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
    const linkedAt = new Date();

    this.logger.log(`[LINE] Self-linked ${lineUserId} to customer ${customer.name} via phone ${phone}`);
    // ห้อง LINE ร้านของคนนี้ที่ถือผู้สนใจอัตโนมัติอยู่ → ดูดเข้าลูกค้าที่เพิ่งผูก (สเปค 3.3 ง)
    // best-effort: ผูก LINE ด้วยเบอร์สำเร็จแล้ว (update ข้างบน commit ไปแล้ว) ต้องไม่ถือว่าล้ม
    // เพราะดูด placeholder ไม่ได้ (เช่น placeholder มีเอกสารพ่วง — absorbPlaceholder โยน 409)
    try {
      await this.merge?.absorbRoomsOfLineUser(lineUserId, 'LINE_SHOP', customer.id, SYSTEM_ACTOR);
    } catch (err) {
      this.logger.warn(
        `[prospect] absorb rooms of ${lineUserId} → ${customer.id}: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { kind: 'chat-prospect' },
        extra: { lineUserId, customerId: customer.id },
      });
    }
    // LINE_LINKED หลังผูกสำเร็จ (absorb ล้มก็ยังบันทึก) · ไม่เก็บ lineUserId และเบอร์
    await this.journey?.recordAfterCommit(
      lineLinkedEntry({ customerId: customer.id, channel: 'SHOP', via: 'SELF_LINK_PHONE', occurredAt: linkedAt }),
    );
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
