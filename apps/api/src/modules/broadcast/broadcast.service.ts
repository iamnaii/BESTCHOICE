import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
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

/**
 * T4-C6: broadcasts >1000 recipients or carrying legal/collection trigger
 * words require a SECOND independent OWNER approval before dispatch. The
 * first approval is the OWNER who calls send; the second must be a
 * different OWNER who calls approveBroadcast(). Trigger words cover seizure
 * / lawsuit / debt-collection language (ยึด/ฟ้อง/คดี/ทวง/ดำเนินคดี/ศาล)
 * because a typo here that reaches 5000 customers has PDPA + reputational
 * blast radius.
 */
const LARGE_AUDIENCE_THRESHOLD = 1000;
const TRIGGER_WORDS = /(ยึด|ฟ้อง|คดี|ทวง|ดำเนินคดี|ศาล)/;

interface ApprovalVerdict {
  required: boolean;
  reason: 'AUDIENCE_SIZE' | 'TRIGGER_WORD' | null;
  triggerMatched: string | null;
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
   * Evaluate whether a broadcast needs a second-approver gate.
   * Pure — no DB writes. Exposed for tests + UI preview.
   */
  evaluateApprovalRequirement(
    message: string,
    audienceSize: number,
  ): ApprovalVerdict {
    if (audienceSize > LARGE_AUDIENCE_THRESHOLD) {
      return { required: true, reason: 'AUDIENCE_SIZE', triggerMatched: null };
    }
    const match = TRIGGER_WORDS.exec(message);
    if (match) {
      return { required: true, reason: 'TRIGGER_WORD', triggerMatched: match[0] };
    }
    return { required: false, reason: null, triggerMatched: null };
  }

  /**
   * T4-C6: Record a second OWNER approval for a queued broadcast.
   * Called by the endpoint that a SECOND OWNER (distinct from the one who
   * called send) hits to clear the gate.
   */
  async approveBroadcast(
    broadcastId: string,
    approverId: string,
    approverRole: string,
  ) {
    if (approverRole !== 'OWNER') {
      throw new ForbiddenException('สิทธิ์อนุมัติ broadcast เฉพาะ OWNER');
    }

    const broadcast = await this.prisma.broadcastMessage.findUnique({
      where: { id: broadcastId },
      include: { approvals: true },
    });
    if (!broadcast) throw new BadRequestException('ไม่พบ broadcast นี้');

    if (broadcast.approvals.some((a) => a.approverId === approverId)) {
      throw new BadRequestException('ผู้ใช้งานคนนี้อนุมัติแล้ว');
    }
    if (broadcast.createdById === approverId) {
      throw new ForbiddenException(
        'ผู้อนุมัติรอบสองต้องไม่ใช่ผู้สร้าง (Segregation of Duties)',
      );
    }

    const verdict = this.evaluateApprovalRequirement(
      this.messageText(broadcast.messages),
      broadcast.audienceCount,
    );

    const approval = await this.prisma.broadcastApproval.create({
      data: {
        broadcastId,
        approverId,
        reason: verdict.reason ?? 'AUDIENCE_SIZE',
        triggerMatched: verdict.triggerMatched,
        audienceSize: broadcast.audienceCount,
      },
    });

    // Audit log for forensics — complements the immutable BroadcastApproval
    await this.prisma.auditLog.create({
      data: {
        userId: approverId,
        action: 'BROADCAST_APPROVAL_GRANTED',
        entity: 'broadcast',
        entityId: broadcastId,
        newValue: {
          reason: verdict.reason,
          triggerMatched: verdict.triggerMatched,
          audienceSize: broadcast.audienceCount,
        },
      },
    });

    const totalApprovals = broadcast.approvals.length + 1;
    const cleared = totalApprovals >= 2;
    if (cleared) {
      await this.prisma.broadcastMessage.update({
        where: { id: broadcastId },
        data: { status: 'APPROVED', approvedById: approverId, approvedAt: new Date() },
      });
    }

    return { approvalId: approval.id, totalApprovals, cleared };
  }

  private messageText(raw: unknown): string {
    // BroadcastMessage.messages is Json[] — safely flatten for trigger scan
    if (Array.isArray(raw)) {
      return raw
        .map((m) => (m && typeof m === 'object' && 'content' in (m as any)) ? String((m as any).content ?? '') : '')
        .join(' ');
    }
    return typeof raw === 'string' ? raw : '';
  }

  /**
   * Send broadcast message to customers on the specified channel.
   * Returns summary of sent/failed counts.
   */
  async sendBroadcast(
    dto: CreateBroadcastDto,
    staffId: string,
  ): Promise<{ total: number; sent: number; failed: number; pendingApprovalId?: string }> {
    // 1. Resolve target customers
    const targets = await this.resolveTargets(dto);

    if (targets.length === 0) {
      throw new BadRequestException('ไม่พบลูกค้าที่ตรงกับเงื่อนไขที่กำหนด');
    }

    // T4-C6: large audience OR legal-risk message → require a second OWNER
    // approver. Persist a PENDING_APPROVAL BroadcastMessage row; actual
    // dispatch happens on the second approval via a separate code path.
    const verdict = this.evaluateApprovalRequirement(dto.message, targets.length);
    if (verdict.required) {
      const queued = await this.prisma.broadcastMessage.create({
        data: {
          messages: [{ type: 'text', content: dto.message }],
          audience: dto.filterTags?.join(',') ?? (dto.customerIds ? 'CUSTOM' : 'ALL'),
          audienceCount: targets.length,
          status: 'PENDING_APPROVAL',
          createdById: staffId,
        },
      });
      await this.prisma.auditLog.create({
        data: {
          userId: staffId,
          action: 'BROADCAST_PENDING_SECOND_APPROVAL',
          entity: 'broadcast',
          entityId: queued.id,
          newValue: {
            reason: verdict.reason,
            triggerMatched: verdict.triggerMatched,
            audienceSize: targets.length,
          },
        },
      });
      this.logger.warn(
        `[Broadcast] Blocked — second approval required: reason=${verdict.reason}, audience=${targets.length}, id=${queued.id}`,
      );
      throw new ForbiddenException(
        verdict.reason === 'AUDIENCE_SIZE'
          ? `Broadcast เกิน ${LARGE_AUDIENCE_THRESHOLD} รายต้องมี OWNER อนุมัติเพิ่มอีก 1 คน (broadcastId=${queued.id})`
          : `ข้อความมีคำที่อ่อนไหวทางกฎหมาย (${verdict.triggerMatched}) ต้องมี OWNER อนุมัติเพิ่มอีก 1 คน (broadcastId=${queued.id})`,
      );
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

    // For non-LINE channels, use ChatRoom.externalUserId
    const sessions = await this.prisma.chatRoom.findMany({
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
    const sessions = await this.prisma.chatRoom.findMany({
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

    // Non-LINE channels: use ChatRoom
    const sessions = await this.prisma.chatRoom.findMany({
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
