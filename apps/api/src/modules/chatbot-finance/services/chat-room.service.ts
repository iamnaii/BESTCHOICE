import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatChannel, ChatRoom, MessageRole, MessageType, Prisma } from '@prisma/client';
import { StaffChatGateway } from '../../staff-chat/staff-chat.gateway';
import { LineFinanceClientService } from './line-finance-client.service';
import { ChatProspectService } from '../../chat-prospects/chat-prospect.service';
import { CustomerMergeService, SYSTEM_ACTOR } from '../../chat-prospects/customer-merge.service';
import { PLACEHOLDER_FIELDS_SELECT, isLivePlaceholder } from '../../chat-prospects/chat-placeholder';

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
    @Optional()
    private chatProspects?: ChatProspectService,
    @Optional()
    private merge?: CustomerMergeService,
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

    const room = await this.prisma.chatRoom.create({
      data: {
        lineUserId,
        channel: ChatChannel.LINE_FINANCE,
        customerId: link?.customerId,
        verifiedAt: link ? new Date() : null,
        displayName: profile?.displayName ?? null,
        pictureUrl: profile?.pictureUrl ?? null,
      },
    });
    if (room.customerId || !this.chatProspects) return room;
    // ผู้สนใจอัตโนมัติ (สเปค 3.2 ข้อ 2) — best-effort; ห้องต้องไม่ล้มเพราะสร้างผู้สนใจไม่ได้
    try {
      const ensured = await this.chatProspects.ensureForRoom(room.id);
      return ensured ? { ...room, customerId: ensured.customerId } : room;
    } catch (err) {
      this.logger.warn(`[prospect] room ${room.id}: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'chat-prospect' }, extra: { roomId: room.id } });
      return room;
    }
  }

  /** บันทึกข้อความ + อัปเดต room stats */
  async saveMessage(params: {
    roomId: string;
    externalMessageId?: string;
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
        externalMessageId: params.externalMessageId,
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
        ...(params.role === MessageRole.CUSTOMER
          ? { unreadCount: { increment: 1 } }
          : {}),
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

  /**
   * Sync room.customerId หลังจาก LIFF verify (CustomerLineLink ถูกสร้างแล้ว)
   * ห้องที่ถือ "ผู้สนใจอัตโนมัติ" (placeholder) อยู่ถูกดูดเข้าคนที่เพิ่งยืนยันตัวตนก่อน (สเปค 3.3 ง)
   * ห้องที่ผูกกับลูกค้าจริงคนอื่นอยู่แล้วไม่ถูกทับ — เก็บประวัติของเจ้าของเดิมไว้ (Ruling R4)
   */
  async linkRoomToCustomer(roomId: string, customerId: string): Promise<void> {
    if (this.merge) {
      const room = await this.prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { id: true, customerId: true, customer: { select: PLACEHOLDER_FIELDS_SELECT } },
      });
      if (room?.customerId && room.customerId !== customerId) {
        if (!isLivePlaceholder(room.customer)) {
          this.logger.debug(
            `[prospect] room ${roomId} already linked to ${room.customerId}, not overwriting with ${customerId}`,
          );
          return;
        }
        // Finding I3 — best-effort แต่ห้ามทับประวัติ placeholder เดิมถ้าดูดไม่สำเร็จ (เช่น
        // placeholder ดันมีเอกสารพ่วงแบบ Task 8's absorbPlaceholder 409): alarm แล้ว return
        // ทันที ไม่รัน chatRoom.update — ปล่อยให้ห้องนี้ยังชี้ placeholder เดิมต่อไป เพื่อให้
        // ข้อความถัดไปจาก LINE user คนนี้มาเดิน linkRoomToCustomer ใหม่ได้ (retry ธรรมชาติ)
        // แทนที่จะตัดขาดห้องออกจาก placeholder ถาวรโดยไม่มี merge เกิดขึ้นจริง. บอทยังตอบลูกค้า
        // ได้ปกติระหว่างนี้เพราะ chatbot-finance.service.ts อ่านข้อมูลลูกค้าจาก linkStatus.customerId
        // ตรง ๆ (ไม่ใช่ session.customerId ของห้อง) ทั้งกิ่งรูปภาพและกิ่งตอบด้วย AI
        try {
          await this.merge.absorbPlaceholder(room.customerId, customerId, SYSTEM_ACTOR);
        } catch (err) {
          this.logger.warn(
            `[prospect] absorb room ${roomId} placeholder ${room.customerId} → ${customerId}: ${err instanceof Error ? err.message : err}`,
          );
          Sentry.captureException(err, {
            tags: { kind: 'chat-prospect' },
            extra: { roomId, placeholderId: room.customerId, customerId },
          });
          return;
        }
      }
    }
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
