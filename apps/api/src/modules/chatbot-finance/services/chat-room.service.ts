import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel, ChatRoom, MessageRole, MessageType, Prisma } from '@prisma/client';
import { StaffChatGateway } from '../../staff-chat/staff-chat.gateway';
import { LineFinanceClientService } from './line-finance-client.service';

/**
 * จัดการ ChatRoom + ChatMessage สำหรับ Finance Bot
 * + emits WebSocket events to Unified Inbox when messages are saved
 */
@Injectable()
export class ChatRoomService {
  private readonly logger = new Logger(ChatRoomService.name);

  constructor(
    private prisma: PrismaService,
    private lineClient: LineFinanceClientService,
    @Optional() @Inject(forwardRef(() => StaffChatGateway))
    private staffChatGateway?: StaffChatGateway,
  ) {}

  /** หา room เดิม หรือสร้างใหม่ */
  async getOrCreate(lineUserId: string): Promise<ChatRoom> {
    const existing = await this.prisma.chatRoom.findUnique({
      where: {
        lineUserId_channel: {
          lineUserId,
          channel: ChatChannel.LINE_FINANCE,
        },
      },
    });
    if (existing) {
      // Backfill profile once per legacy room (pre-feature rooms have null displayName)
      if (!existing.displayName) {
        const profile = await this.lineClient.getUserProfile(lineUserId);
        if (profile?.displayName) {
          return this.prisma.chatRoom.update({
            where: { id: existing.id },
            data: { displayName: profile.displayName, pictureUrl: profile.pictureUrl ?? null },
          });
        }
      }
      return existing;
    }

    // ลองหา customer ที่ link ไว้แล้วผ่าน CustomerLineLink
    const link = await this.prisma.customerLineLink.findUnique({
      where: {
        lineUserId_channel: {
          lineUserId,
          channel: 'FINANCE',
        },
      },
    });

    const profile = await this.lineClient.getUserProfile(lineUserId);

    return this.prisma.chatRoom.create({
      data: {
        lineUserId,
        channel: ChatChannel.LINE_FINANCE,
        customerId: link?.customerId,
        verifiedAt: link ? new Date() : null,
        displayName: profile?.displayName ?? null,
        pictureUrl: profile?.pictureUrl ?? null,
      },
    });
  }

  /** บันทึกข้อความ + อัปเดต room stats */
  async saveMessage(params: {
    roomId: string;
    role: MessageRole;
    type?: MessageType;
    text?: string;
    mediaUrl?: string;
    mediaType?: string;
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
        role: params.role,
        type: params.type ?? MessageType.TEXT,
        text: params.text,
        mediaUrl: params.mediaUrl,
        mediaType: params.mediaType,
        intent: params.intent,
        modelUsed: params.modelUsed,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        toolsUsed: params.toolsUsed ?? [],
        costUsd: params.costUsd,
        visionExtracted: params.visionExtracted,
      },
    });

    await this.prisma.chatRoom.update({
      where: { id: params.roomId },
      data: {
        totalMessages: { increment: 1 },
        lastMessageAt: new Date(),
      },
    });

    // Emit to Unified Inbox via WebSocket (best-effort)
    try {
      this.staffChatGateway?.emitNewMessage(params.roomId, {
        roomId: params.roomId,
        messageId: msg.id,
        role: params.role,
        text: params.text,
        createdAt: msg.createdAt.toISOString(),
      });
    } catch {
      // WS not available — ignore
    }

    return msg;
  }

  /** ดึง history N ข้อความล่าสุด (สำหรับใส่ใน AI context) */
  async getRecentMessages(roomId: string, limit = 20) {
    const msgs = await this.prisma.chatMessage.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return msgs.reverse();
  }

  /** Sync room.customerId หลังจาก LIFF verify (CustomerLineLink ถูกสร้างแล้ว) */
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
}
