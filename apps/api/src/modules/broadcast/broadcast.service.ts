import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { LineFinanceClientService } from '../chatbot-finance/services/line-finance-client.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { ChatChannel } from '@prisma/client';

interface BroadcastTarget {
  customerId: string;
  externalUserId: string; // lineUserId, FB PSID, etc.
  displayName: string;
}

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    private prisma: PrismaService,
    private lineOaService: LineOaService,
    private lineFinanceClient: LineFinanceClientService,
  ) {}

  /**
   * Send broadcast message to customers on the specified channel.
   * Returns summary of sent/failed counts.
   */
  async sendBroadcast(
    dto: CreateBroadcastDto,
    staffId: string,
  ): Promise<{ total: number; sent: number; failed: number }> {
    // 1. Resolve target customers
    const targets = await this.resolveTargets(dto);

    if (targets.length === 0) {
      throw new BadRequestException('ไม่พบลูกค้าที่ตรงกับเงื่อนไขที่กำหนด');
    }

    this.logger.log(
      `[Broadcast] Starting: channel=${dto.channel}, targets=${targets.length}, staffId=${staffId}`,
    );

    const broadcastId = `broadcast-${Date.now()}`;
    let sent = 0;
    let failed = 0;

    // 2. Send messages with rate limiting (100ms delay between sends)
    for (const target of targets) {
      try {
        await this.sendToTarget(dto, target);

        // Log success
        await this.prisma.notificationLog.create({
          data: {
            channel: 'LINE',
            recipient: target.externalUserId,
            subject: `broadcast:${dto.channel}`,
            message: dto.message,
            status: 'SENT',
            sentAt: new Date(),
            relatedId: broadcastId,
          },
        });

        sent++;
      } catch (err) {
        this.logger.warn(
          `[Broadcast] Failed for ${target.customerId}: ${err instanceof Error ? err.message : String(err)}`,
        );

        // Log failure
        await this.prisma.notificationLog.create({
          data: {
            channel: 'LINE',
            recipient: target.externalUserId,
            subject: `broadcast:${dto.channel}`,
            message: dto.message,
            status: 'FAILED',
            errorMsg: err instanceof Error ? err.message : String(err),
            sentAt: new Date(),
            relatedId: broadcastId,
          },
        });

        failed++;
      }

      // Rate limit: 100ms delay between sends
      await this.delay(100);
    }

    this.logger.log(
      `[Broadcast] Complete: total=${targets.length}, sent=${sent}, failed=${failed}`,
    );

    return { total: targets.length, sent, failed };
  }

  /**
   * Resolve target customers based on customerIds or filterTags.
   */
  private async resolveTargets(dto: CreateBroadcastDto): Promise<BroadcastTarget[]> {
    const { channel, customerIds, filterTags } = dto;

    // Strategy 1: Explicit customer IDs
    if (customerIds && customerIds.length > 0) {
      return this.resolveByCustomerIds(customerIds, channel);
    }

    // Strategy 2: Filter by conversation tags
    if (filterTags && filterTags.length > 0) {
      return this.resolveByTags(filterTags, channel);
    }

    // Strategy 3: All customers with a session on this channel
    return this.resolveAllOnChannel(channel);
  }

  private async resolveByCustomerIds(
    customerIds: string[],
    channel: ChatChannel,
  ): Promise<BroadcastTarget[]> {
    if (channel === ChatChannel.LINE_FINANCE || channel === ChatChannel.LINE_SHOP) {
      // Use CustomerLineLink for LINE channels
      const lineChannelType = channel === ChatChannel.LINE_FINANCE ? 'FINANCE' : 'SHOP';
      const links = await this.prisma.customerLineLink.findMany({
        where: {
          customerId: { in: customerIds },
          channel: lineChannelType,
          deletedAt: null,
          unlinkedAt: null,
        },
        include: {
          customer: { select: { name: true } },
        },
      });

      return links.map((link) => ({
        customerId: link.customerId,
        externalUserId: link.lineUserId,
        displayName: link.customer?.name ?? 'ลูกค้า',
      }));
    }

    // For non-LINE channels, use ChatSession.externalUserId
    const sessions = await this.prisma.chatSession.findMany({
      where: {
        customerId: { in: customerIds },
        channel,
        deletedAt: null,
        externalUserId: { not: null },
      },
      include: {
        customer: { select: { name: true } },
      },
    });

    return sessions
      .filter((s) => s.externalUserId && (s as any).customer)
      .map((s) => ({
        customerId: s.customerId!,
        externalUserId: s.externalUserId!,
        displayName: (s as any).customer?.name ?? 'ลูกค้า',
      }));
  }

  private async resolveByTags(
    filterTags: string[],
    channel: ChatChannel,
  ): Promise<BroadcastTarget[]> {
    // Find sessions that have ALL of the specified tags on the given channel
    const sessions = await this.prisma.chatSession.findMany({
      where: {
        channel,
        deletedAt: null,
        customerId: { not: null },
      },
      include: {
        customer: { select: { name: true } },
        tags: { select: { tag: true } },
      },
    });

    // Filter to sessions that have ALL specified tags
    const filtered = sessions.filter((s) => {
      const sessionTags = (s as any).tags?.map((t: any) => t.tag) ?? [];
      return filterTags.every((ft) => sessionTags.includes(ft));
    });

    if (channel === ChatChannel.LINE_FINANCE || channel === ChatChannel.LINE_SHOP) {
      // For LINE channels, resolve lineUserId from CustomerLineLink
      const customerIds = filtered.map((s) => s.customerId!).filter(Boolean);
      return this.resolveByCustomerIds(customerIds, channel);
    }

    return filtered
      .filter((s) => s.externalUserId && (s as any).customer)
      .map((s) => ({
        customerId: s.customerId!,
        externalUserId: s.externalUserId!,
        displayName: (s as any).customer?.name ?? 'ลูกค้า',
      }));
  }

  private async resolveAllOnChannel(channel: ChatChannel): Promise<BroadcastTarget[]> {
    if (channel === ChatChannel.LINE_FINANCE || channel === ChatChannel.LINE_SHOP) {
      const lineChannelType = channel === ChatChannel.LINE_FINANCE ? 'FINANCE' : 'SHOP';
      const links = await this.prisma.customerLineLink.findMany({
        where: {
          channel: lineChannelType,
          deletedAt: null,
          unlinkedAt: null,
        },
        include: {
          customer: { select: { name: true } },
        },
      });

      return links.map((link) => ({
        customerId: link.customerId,
        externalUserId: link.lineUserId,
        displayName: link.customer?.name ?? 'ลูกค้า',
      }));
    }

    // Non-LINE channels: use ChatSession
    const sessions = await this.prisma.chatSession.findMany({
      where: {
        channel,
        deletedAt: null,
        customerId: { not: null },
        externalUserId: { not: null },
      },
      include: {
        customer: { select: { name: true } },
      },
    });

    return sessions
      .filter((s) => s.externalUserId && (s as any).customer)
      .map((s) => ({
        customerId: s.customerId!,
        externalUserId: s.externalUserId!,
        displayName: (s as any).customer?.name ?? 'ลูกค้า',
      }));
  }

  /**
   * Send a message to a single target via the appropriate channel adapter.
   */
  private async sendToTarget(dto: CreateBroadcastDto, target: BroadcastTarget): Promise<void> {
    switch (dto.channel) {
      case ChatChannel.LINE_FINANCE:
        await this.lineFinanceClient.pushText(target.externalUserId, dto.message);
        break;

      case ChatChannel.LINE_SHOP:
        await this.lineOaService.pushMessage(target.externalUserId, [
          { type: 'text', text: dto.message },
        ]);
        break;

      case ChatChannel.FACEBOOK:
      case ChatChannel.TIKTOK:
      case ChatChannel.WEB:
        // These channels don't support push messaging yet
        throw new Error(`ช่องทาง ${dto.channel} ยังไม่รองรับการส่งข้อความแบบ broadcast`);

      default:
        throw new Error(`ไม่รู้จักช่องทาง: ${dto.channel}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
