import {
  Injectable,
  Logger,
  Optional,
  Inject,
  forwardRef,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AdsPlatform,
  ChatChannel,
  ChatRoom,
  ChatRoomStatus,
  ChatPriority,
  MessageRole,
  MessageType,
  Prisma,
} from '@prisma/client';
import { AssignmentService } from './assignment.service';
import { MessageRouterService } from './message-router.service';
import { ChatAiDraftService } from '../../chat-ai-draft/chat-ai-draft.service';
import { StorageService } from '../../storage/storage.service';
import { signMessageMedia } from './media-url.util';

/**
 * RoomManagerService — generalized from SessionManagerService.
 *
 * Manages chat rooms across ALL channels (not just LINE Finance).
 * Key behaviour change: ALWAYS returns the existing room for the same
 * (externalUserId, channel). Never creates a new room if one already exists.
 * If the room is IDLE it is reopened to ACTIVE.
 */
@Injectable()
export class RoomManagerService {
  private readonly logger = new Logger(RoomManagerService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    @Optional() @Inject(forwardRef(() => AssignmentService))
    private assignmentService?: AssignmentService,
    @Optional() @Inject(forwardRef(() => MessageRouterService))
    private messageRouter?: MessageRouterService,
    @Optional() @Inject(forwardRef(() => ChatAiDraftService))
    private chatAiDraftService?: ChatAiDraftService,
  ) {}

  /**
   * Find or create a room for any channel.
   * ALWAYS returns existing room for same (externalUserId, channel).
   * Only creates a new room if truly none exists.
   */
  async getOrCreateRoom(params: {
    externalUserId: string;
    channel: ChatChannel;
    customerId?: string;
    displayName?: string | null;
    pictureUrl?: string | null;
    attribution?: {
      utmSource?: string;
      utmCampaign?: string;
      utmContent?: string;
      referrerUrl?: string;
    };
  }): Promise<ChatRoom> {
    const isLineChannel =
      params.channel === ChatChannel.LINE_FINANCE ||
      params.channel === ChatChannel.LINE_SHOP;

    // Always find existing room first — no status filter
    let existing: ChatRoom | null = null;

    if (isLineChannel) {
      existing = await this.prisma.chatRoom.findUnique({
        where: {
          lineUserId_channel: {
            lineUserId: params.externalUserId,
            channel: params.channel,
          },
        },
      });
    } else {
      existing = await this.prisma.chatRoom.findFirst({
        where: {
          externalUserId: params.externalUserId,
          channel: params.channel,
          deletedAt: null,
        },
      });
    }

    if (existing) {
      const updateData: Prisma.ChatRoomUpdateInput = {};
      // Reopen if IDLE
      if (existing.status === ChatRoomStatus.IDLE) {
        updateData.status = ChatRoomStatus.ACTIVE;
      }
      // Backfill profile for legacy rooms — displayName and pictureUrl handled
      // INDEPENDENTLY so a room that already has a name (e.g. from the FB
      // conversations-API fallback, which has no avatar) still gets its picture
      // filled in the next time getUserProfile can resolve one. routeInbound
      // already fetches the profile on every inbound, so this adds no API calls.
      if (!existing.displayName && params.displayName) {
        updateData.displayName = params.displayName;
      }
      if (!existing.pictureUrl && params.pictureUrl) {
        updateData.pictureUrl = params.pictureUrl;
      }
      if (Object.keys(updateData).length > 0) {
        return this.prisma.chatRoom.update({
          where: { id: existing.id },
          data: updateData,
        });
      }
      return existing;
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

    const room = await this.prisma.chatRoom.create({
      data: {
        lineUserId: isLineChannel ? params.externalUserId : null,
        externalUserId: isLineChannel ? undefined : params.externalUserId,
        channel: params.channel,
        customerId,
        verifiedAt: customerId ? new Date() : null,
        status: ChatRoomStatus.ACTIVE,
        priority: ChatPriority.NORMAL,
        displayName: params.displayName ?? null,
        pictureUrl: params.pictureUrl ?? null,
      },
    });

    // Link ads attribution on new rooms (best-effort — never block room creation)
    if (params.attribution?.utmSource) {
      try {
        const platformMap: Record<string, AdsPlatform> = {
          facebook: AdsPlatform.FACEBOOK_ADS,
          tiktok: AdsPlatform.TIKTOK_ADS,
          line: AdsPlatform.LINE_ADS,
          google: AdsPlatform.GOOGLE_ADS,
        };
        const platform =
          platformMap[params.attribution.utmSource.toLowerCase()] ??
          AdsPlatform.FACEBOOK_ADS;
        const campaignKey = params.attribution.utmCampaign ?? 'organic';

        let campaign = await this.prisma.adsCampaign.findFirst({
          where: {
            platform,
            campaignId: campaignKey,
            deletedAt: null,
          },
        });
        if (!campaign) {
          campaign = await this.prisma.adsCampaign.create({
            data: {
              platform,
              campaignId: campaignKey,
              campaignName: params.attribution.utmCampaign ?? 'Auto-detected',
            },
          });
        }

        const attribution = await this.prisma.adsAttribution.create({
          data: {
            campaignId: campaign.id,
            utmSource: params.attribution.utmSource,
            utmCampaign: params.attribution.utmCampaign,
            utmContent: params.attribution.utmContent,
            referrerUrl: params.attribution.referrerUrl,
            firstTouch: new Date(),
          },
        });

        await this.prisma.chatRoom.update({
          where: { id: room.id },
          data: { attributionId: attribution.id },
        });

        this.logger.log(
          `[Attribution] Linked campaign "${campaignKey}" to room ${room.id}`,
        );
      } catch (err) {
        this.logger.error(
          `[Attribution] Failed to link attribution for room ${room.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Auto-assign to least-busy staff (best-effort)
    try {
      await this.assignmentService?.autoAssign(room.id);
    } catch {
      // Assignment failure shouldn't block room creation
    }

    return room;
  }

  /** Save a message and update room stats */
  async saveMessage(params: {
    roomId: string;
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
        roomId: params.roomId,
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
    const updateData: Prisma.ChatRoomUpdateInput = {
      totalMessages: { increment: 1 },
      lastMessageAt: new Date(),
    };

    if (params.role === MessageRole.CUSTOMER) {
      // Inbound message — increment unread until staff opens the room (markAsRead resets it).
      updateData.unreadCount = { increment: 1 };
    } else if (params.role === MessageRole.STAFF || params.role === MessageRole.BOT) {
      // Set firstResponseAt if not already set (SLA metric)
      const room = await this.prisma.chatRoom.findUnique({
        where: { id: params.roomId },
        select: { firstResponseAt: true },
      });
      if (!room?.firstResponseAt) {
        updateData.firstResponseAt = new Date();
      }
    }

    await this.prisma.chatRoom.update({
      where: { id: params.roomId },
      data: updateData,
    });

    // Fire-and-forget AI draft generation for inbound customer messages.
    // ChatAiDraftService internally respects room.aiPaused and AiSettings mode.
    // Never block webhook ACK on draft generation.
    if (params.role === MessageRole.CUSTOMER && this.chatAiDraftService) {
      this.chatAiDraftService.generateDraft(msg.id).catch((err) => {
        this.logger.error(
          `[ChatAiDraft] draft generation failed for ${msg.id}: ${err instanceof Error ? err.message : err}`,
        );
      });
    }

    return msg;
  }

  /** Get recent messages for AI context or display */
  async getRecentMessages(roomId: string, limit = 20) {
    const msgs = await this.prisma.chatMessage.findMany({
      where: { roomId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { staff: { select: { id: true, name: true, avatarUrl: true } } },
    });
    const ordered = msgs.reverse();
    // Sign storage-key mediaUrls so the inbox can render staff-uploaded media
    // directly (uploadFile persists a raw key). Inbound LINE images already
    // carry an http(s) URL; line:// refs are fetched via the media endpoint.
    if (!this.storageService.configured) return ordered;
    return signMessageMedia(ordered, (key) => this.storageService.getSignedDownloadUrl(key, 3600));
  }

  /** Find room by ID with customer and assignment info */
  async findById(roomId: string) {
    return this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      include: {
        customer: { select: { id: true, name: true, phone: true, nationalId: true } },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        tags: true,
      },
    });
  }

  /**
   * Link an existing Customer record to a ChatRoom. Throws if the room is
   * already linked to a different customer — relinking requires explicit
   * unlink-then-link, not silent overwrite.
   */
  async linkCustomer(roomId: string, customerId: string) {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, customerId: true, deletedAt: true },
    });
    if (!room || room.deletedAt) {
      throw new NotFoundException('ห้องแชทไม่พบหรือถูกลบ');
    }
    if (room.customerId && room.customerId !== customerId) {
      throw new ConflictException('ห้องแชทนี้ผูกกับลูกค้ารายอื่นอยู่แล้ว');
    }
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, deletedAt: true },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException('ไม่พบลูกค้า');
    }
    return this.prisma.chatRoom.update({
      where: { id: roomId },
      data: { customerId },
    });
  }

  /** List rooms for the unified inbox with pagination and filters */
  async listRooms(params: {
    channel?: ChatChannel;
    status?: ChatRoomStatus;
    priority?: ChatPriority;
    assignedToId?: string;
    customerId?: string;
    unassignedOnly?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Prisma.ChatRoomWhereInput = {
      deletedAt: null,
    };

    if (params.channel) where.channel = params.channel;
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.assignedToId) where.assignedToId = params.assignedToId;
    if (params.customerId) where.customerId = params.customerId;
    if (params.unassignedOnly) where.assignedToId = null;
    if (params.search) {
      where.OR = [
        { customer: { name: { contains: params.search, mode: 'insensitive' } } },
        { customer: { phone: { contains: params.search } } },
        { lineUserId: { contains: params.search } },
        // FB/TikTok/Web rooms often have no linked Customer yet — match on
        // the platform-fetched displayName + the channel-specific user id
        // (FB PSID, TikTok user id, web visitor id).
        { displayName: { contains: params.search, mode: 'insensitive' } },
        { externalUserId: { contains: params.search } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.chatRoom.findMany({
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
      this.prisma.chatRoom.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /** Link room to a verified customer */
  async linkRoomToCustomer(roomId: string, customerId: string): Promise<void> {
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        customerId,
        verifiedAt: new Date(),
        verificationAttempts: 0,
      },
    });
  }

  /** Get active room count for a staff member (or all if no staffId) */
  async getUnreadCount(staffId?: string) {
    const where: Prisma.ChatRoomWhereInput = {
      deletedAt: null,
      status: ChatRoomStatus.ACTIVE,
      handoffMode: true,
    };
    if (staffId) {
      where.OR = [{ assignedToId: staffId }, { assignedToId: null }];
    }
    const count = await this.prisma.chatRoom.count({ where });
    return { unread: count };
  }

  /** Search messages across all rooms */
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
      where.room = { channel: params.channel, deletedAt: null };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          room: {
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

  /** Update room status */
  async updateRoomStatus(
    roomId: string,
    status: ChatRoomStatus,
  ): Promise<ChatRoom> {
    const data: Prisma.ChatRoomUpdateInput = { status };
    if (status === ChatRoomStatus.IDLE) {
      data.resolvedAt = new Date();
    }
    return this.prisma.chatRoom.update({ where: { id: roomId }, data });
  }

  /** Mark all unread customer messages in a room as read */
  async markMessagesRead(
    roomId: string,
    readAt: Date,
  ): Promise<{ count: number }> {
    const result = await this.prisma.chatMessage.updateMany({
      where: {
        roomId,
        role: MessageRole.CUSTOMER,
        readAt: null,
      },
      data: { readAt },
    });
    return { count: result.count };
  }

  /**
   * Throw a clean 404 for an unknown/soft-deleted room instead of letting the
   * subsequent `update` raise Prisma P2025 — which the global filter would
   * surface as a 500 + Sentry alert for what is an ordinary not-found.
   */
  private async assertRoomExists(roomId: string): Promise<void> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, deletedAt: true },
    });
    if (!room || room.deletedAt) throw new NotFoundException('ไม่พบห้องแชท');
  }

  /** Pin a room (records who pinned it and when) */
  async pinRoom(roomId: string, userId: string): Promise<void> {
    await this.assertRoomExists(roomId);
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: { pinnedAt: new Date(), pinnedById: userId },
    });
  }

  /** Unpin a room */
  async unpinRoom(roomId: string): Promise<void> {
    await this.assertRoomExists(roomId);
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: { pinnedAt: null, pinnedById: null },
    });
  }

  /**
   * Mark all unread customer messages in a room as read, recompute the
   * remaining unread count, and persist it on the room — all in one
   * transaction so the room's unreadCount can never drift from the
   * messages' readAt state.
   */
  async markAsRead(roomId: string): Promise<{ markedCount: number }> {
    await this.assertRoomExists(roomId);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.chatMessage.updateMany({
        where: { roomId: roomId, role: 'CUSTOMER', readAt: null },
        data: { readAt: now },
      });
      const remaining = await tx.chatMessage.count({
        where: { roomId: roomId, role: 'CUSTOMER', readAt: null },
      });
      await tx.chatRoom.update({
        where: { id: roomId },
        data: { unreadCount: remaining },
      });
      return { markedCount: updated.count };
    });
  }

  /**
   * Store an uploaded file and save it as a chat message with media.
   * Returns the persisted key + a (signed) download URL for the caller.
   */
  async uploadFile(
    roomId: string,
    file: Express.Multer.File,
    userId: string | undefined,
  ): Promise<{ success: boolean; url: string; key: string; filename: string }> {
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    };
    const ext = extMap[file.mimetype] || '';
    const key = `staff-chat/${roomId}/${Date.now()}${ext}`;

    await this.storageService.upload(key, file.buffer, file.mimetype);
    const downloadUrl = this.storageService.configured
      ? await this.storageService.getSignedDownloadUrl(key, 3600)
      : key;

    // Save as a message with media
    await this.saveMessage({
      roomId,
      role: MessageRole.BOT,
      type: file.mimetype.startsWith('image/') ? MessageType.IMAGE : MessageType.FILE,
      text: file.originalname,
      mediaUrl: key,
      mediaType: file.mimetype,
      staffId: userId,
    });

    return { success: true, url: downloadUrl, key, filename: file.originalname };
  }

  /**
   * Last N messages across the customer's LINE rooms (LINE_FINANCE preferred).
   * Used by the Customer 360 LineChatPanel — collectors don't need to leave
   * the collections workspace to see what was said in chat.
   *
   * Returns messages in reverse-chronological order (newest first) so
   * `before=<oldest.id>` paging walks backward through history. The frontend
   * reverses for display.
   */
  async getCustomerMessages(customerId: string, take: number, before?: string) {
    // Find the customer's LINE Finance room (preferred) or fall back to any
    // LINE room. Collections is a finance-only workflow — no point pulling
    // shop-side LINE chat here.
    const room = await this.prisma.chatRoom.findFirst({
      where: {
        customerId,
        deletedAt: null,
        channel: { in: [ChatChannel.LINE_FINANCE, ChatChannel.LINE_SHOP] },
      },
      orderBy: [
        // Prefer LINE_FINANCE if both exist (alphabetical "LINE_FINANCE" <
        // "LINE_SHOP" so an explicit ordering by lastMessageAt is the
        // tiebreaker that matters).
        { lastMessageAt: 'desc' },
      ],
      select: {
        id: true,
        channel: true,
        lineUserId: true,
        lastMessageAt: true,
        unreadCount: true,
      },
    });

    if (!room) {
      return { roomId: null, channel: null, messages: [], hasMore: false };
    }

    let cursorWhere: { createdAt?: { lt: Date } } = {};
    if (before) {
      const cursor = await this.prisma.chatMessage.findUnique({
        where: { id: before },
        select: { createdAt: true },
      });
      if (cursor) cursorWhere = { createdAt: { lt: cursor.createdAt } };
    }

    const messages = await this.prisma.chatMessage.findMany({
      where: { roomId: room.id, deletedAt: null, ...cursorWhere },
      orderBy: { createdAt: 'desc' },
      take: take + 1, // overfetch by 1 to detect hasMore
      select: {
        id: true,
        role: true,
        type: true,
        text: true,
        mediaUrl: true,
        mediaType: true,
        createdAt: true,
        readAt: true,
        deliveredAt: true,
        staff: { select: { id: true, name: true } },
      },
    });

    const hasMore = messages.length > take;
    const sliced = hasMore ? messages.slice(0, take) : messages;

    return {
      roomId: room.id,
      channel: room.channel,
      messages: sliced,
      hasMore,
    };
  }

  /**
   * Resolve the customer's LINE room (Finance preferred) and forward the
   * staff message through MessageRouterService. Returns `{ room: null }`
   * when the customer has no LINE room so the caller can surface a
   * non-throwing error; otherwise returns the resolved room + send result.
   */
  async sendCustomerMessage(
    customerId: string,
    staffId: string,
    text: string,
  ): Promise<
    | { room: null }
    | { room: { id: string }; result: { success: boolean; error?: string } }
  > {
    const room = await this.prisma.chatRoom.findFirst({
      where: {
        customerId,
        deletedAt: null,
        channel: { in: [ChatChannel.LINE_FINANCE, ChatChannel.LINE_SHOP] },
      },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });

    if (!room) {
      return { room: null };
    }

    const result = await this.messageRouter!.sendStaffMessage({
      roomId: room.id,
      staffId,
      text,
    });

    return { room, result };
  }

  /** All of a room's customer's rooms across channels, with the latest message each */
  async getCrossChannelRooms(roomId: string) {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { customerId: true },
    });
    if (!room?.customerId) return [];
    return this.prisma.chatRoom.findMany({
      where: { customerId: room.customerId, deletedAt: null },
      select: {
        id: true,
        channel: true,
        lastMessageAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { text: true, createdAt: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }
}
