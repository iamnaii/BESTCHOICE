import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ChatChannel,
  ChatSession,
  ChatSessionStatus,
  ChatPriority,
  MessageRole,
  MessageType,
  Prisma,
} from '@prisma/client';
import { AssignmentService } from './assignment.service';

/**
 * SessionManagerService — generalized from ChatSessionService.
 *
 * Manages chat sessions across ALL channels (not just LINE Finance).
 * The key difference from the original: it resolves sessions by
 * (externalUserId, channel) instead of hardcoding LINE_FINANCE.
 */
@Injectable()
export class SessionManagerService {
  private readonly logger = new Logger(SessionManagerService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() @Inject(forwardRef(() => AssignmentService))
    private assignmentService?: AssignmentService,
  ) {}

  /**
   * Find or create a session for any channel.
   * Uses lineUserId for LINE channels, externalUserId for others.
   */
  async getOrCreateSession(params: {
    externalUserId: string;
    channel: ChatChannel;
    customerId?: string;
  }): Promise<ChatSession> {
    // LINE channels use the unique constraint on (lineUserId, channel)
    const isLineChannel =
      params.channel === ChatChannel.LINE_FINANCE ||
      params.channel === ChatChannel.LINE_SHOP;

    if (isLineChannel) {
      const existing = await this.prisma.chatSession.findUnique({
        where: {
          lineUserId_channel: {
            lineUserId: params.externalUserId,
            channel: params.channel,
          },
        },
      });
      if (existing) return existing;
    } else {
      // Non-LINE channels: lookup by externalUserId + channel
      const existing = await this.prisma.chatSession.findFirst({
        where: {
          externalUserId: params.externalUserId,
          channel: params.channel,
          deletedAt: null,
        },
      });
      if (existing) return existing;
    }

    // Try to find linked customer
    let customerId = params.customerId;
    if (!customerId && isLineChannel) {
      const channelType = params.channel === ChatChannel.LINE_FINANCE ? 'FINANCE' : 'SHOP';
      const link = await this.prisma.customerLineLink.findUnique({
        where: {
          lineUserId_channel: {
            lineUserId: params.externalUserId,
            channel: channelType,
          },
        },
      });
      customerId = link?.customerId;
    }

    const session = await this.prisma.chatSession.create({
      data: {
        lineUserId: isLineChannel ? params.externalUserId : '',
        externalUserId: isLineChannel ? undefined : params.externalUserId,
        channel: params.channel,
        customerId,
        verifiedAt: customerId ? new Date() : null,
        sessionStatus: ChatSessionStatus.OPEN,
        priority: ChatPriority.NORMAL,
      },
    });

    // Auto-assign to least-busy staff (best-effort)
    try {
      await this.assignmentService?.autoAssign(session.id);
    } catch {
      // Assignment failure shouldn't block session creation
    }

    return session;
  }

  /** Save a message and update session stats */
  async saveMessage(params: {
    sessionId: string;
    externalMessageId?: string;
    role: MessageRole;
    type?: MessageType;
    text?: string;
    mediaUrl?: string;
    mediaType?: string;
    staffId?: string;
    intent?: string;
    modelUsed?: string;
    inputTokens?: number;
    outputTokens?: number;
    toolsUsed?: string[];
    costUsd?: number;
    visionExtracted?: Prisma.InputJsonValue;
  }) {
    const msg = await this.prisma.chatMessage.create({
      data: {
        sessionId: params.sessionId,
        externalMessageId: params.externalMessageId,
        role: params.role,
        type: params.type ?? MessageType.TEXT,
        text: params.text,
        mediaUrl: params.mediaUrl,
        mediaType: params.mediaType,
        staffId: params.staffId,
        intent: params.intent,
        modelUsed: params.modelUsed,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        toolsUsed: params.toolsUsed ?? [],
        costUsd: params.costUsd,
        visionExtracted: params.visionExtracted,
      },
    });

    // Track first staff/bot response for SLA
    const updateData: Prisma.ChatSessionUpdateInput = {
      totalMessages: { increment: 1 },
      lastMessageAt: new Date(),
    };

    if (params.role === MessageRole.STAFF || params.role === MessageRole.BOT) {
      // Set firstResponseAt if not already set (SLA metric)
      const session = await this.prisma.chatSession.findUnique({
        where: { id: params.sessionId },
        select: { firstResponseAt: true },
      });
      if (!session?.firstResponseAt) {
        updateData.firstResponseAt = new Date();
      }
    }

    await this.prisma.chatSession.update({
      where: { id: params.sessionId },
      data: updateData,
    });

    return msg;
  }

  /** Get recent messages for AI context or display */
  async getRecentMessages(sessionId: string, limit = 20) {
    const msgs = await this.prisma.chatMessage.findMany({
      where: { sessionId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { staff: { select: { id: true, name: true, avatarUrl: true } } },
    });
    return msgs.reverse();
  }

  /** Find session by ID with customer and assignment info */
  async findById(sessionId: string) {
    return this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        customer: { select: { id: true, name: true, phone: true, nationalId: true } },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        tags: true,
      },
    });
  }

  /** List sessions for the unified inbox with pagination and filters */
  async listSessions(params: {
    channel?: ChatChannel;
    sessionStatus?: ChatSessionStatus;
    priority?: ChatPriority;
    assignedToId?: string;
    unassignedOnly?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Prisma.ChatSessionWhereInput = {
      deletedAt: null,
    };

    if (params.channel) where.channel = params.channel;
    if (params.sessionStatus) where.sessionStatus = params.sessionStatus;
    if (params.priority) where.priority = params.priority;
    if (params.assignedToId) where.assignedToId = params.assignedToId;
    if (params.unassignedOnly) where.assignedToId = null;
    if (params.search) {
      where.OR = [
        { customer: { name: { contains: params.search, mode: 'insensitive' } } },
        { customer: { phone: { contains: params.search } } },
        { lineUserId: { contains: params.search } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.chatSession.findMany({
        where,
        orderBy: [
          { priority: 'desc' },
          { lastMessageAt: 'desc' },
        ],
        skip,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          assignedTo: { select: { id: true, name: true, avatarUrl: true } },
          tags: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { text: true, role: true, createdAt: true },
          },
        },
      }),
      this.prisma.chatSession.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /** Link session to a verified customer */
  async linkSessionToCustomer(sessionId: string, customerId: string): Promise<void> {
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        customerId,
        verifiedAt: new Date(),
        verificationAttempts: 0,
      },
    });
  }

  /** Get unread session count for a staff member (or all if no staffId) */
  async getUnreadCount(staffId?: string) {
    const where: Prisma.ChatSessionWhereInput = {
      deletedAt: null,
      sessionStatus: { in: [ChatSessionStatus.OPEN, ChatSessionStatus.HANDOFF] },
    };
    if (staffId) {
      where.OR = [{ assignedToId: staffId }, { assignedToId: null }];
    }
    const count = await this.prisma.chatSession.count({ where });
    return { unread: count };
  }

  /** Search messages across all sessions */
  async searchMessages(params: {
    query: string;
    channel?: ChatChannel;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ChatMessageWhereInput = {
      deletedAt: null,
      text: { contains: params.query, mode: 'insensitive' },
    };
    if (params.channel) {
      where.session = { channel: params.channel, deletedAt: null };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          session: {
            select: {
              id: true,
              channel: true,
              customer: { select: { id: true, name: true } },
            },
          },
          staff: { select: { id: true, name: true } },
        },
      }),
      this.prisma.chatMessage.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /** Update session status */
  async updateSessionStatus(
    sessionId: string,
    status: ChatSessionStatus,
  ): Promise<ChatSession> {
    const data: Prisma.ChatSessionUpdateInput = { sessionStatus: status };
    if (status === ChatSessionStatus.RESOLVED) {
      data.resolvedAt = new Date();
    }
    return this.prisma.chatSession.update({ where: { id: sessionId }, data });
  }
}
