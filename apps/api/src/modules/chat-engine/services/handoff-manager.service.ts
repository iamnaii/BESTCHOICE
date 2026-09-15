import { Injectable, Logger, Inject, Optional, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatRoomStatus, ChatPriority } from '@prisma/client';
import { IChatGateway, CHAT_GATEWAY_TOKEN } from '../interfaces/chat-gateway.interface';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { botHandoffEntry } from '../../customer-journey/chat-identity-entries';

export interface HandoffParams {
  roomId: string;
  reason: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  summary: string;
  tags?: string[];
}

const PRIORITY_MAP: Record<string, ChatPriority> = {
  low: ChatPriority.LOW,
  normal: ChatPriority.NORMAL,
  high: ChatPriority.HIGH,
  critical: ChatPriority.CRITICAL,
};

/**
 * HandoffManagerService — extracted and generalized from chatbot-finance HandoffService.
 *
 * Manages the transition from AI-handled to staff-handled conversations.
 * Works across all channels (not just LINE Finance).
 */
@Injectable()
export class HandoffManagerService {
  private readonly logger = new Logger(HandoffManagerService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() @Inject(CHAT_GATEWAY_TOKEN) private gateway?: IChatGateway,
    // การเดินทางของลูกค้า — BOT_HANDOFF (chat_rooms.handoffReason ถูกเขียนทับทุกรอบและถูกล้างตอนปิดงาน)
    @Optional() private journey?: JourneyEntryWriter,
  ) {}

  /** Initiate handoff — mark room for staff pickup */
  async initiateHandoff(params: HandoffParams): Promise<void> {
    const taggedAt = new Date();
    const room = await this.prisma.chatRoom.update({
      where: { id: params.roomId },
      data: {
        handoffMode: true,
        handoffReason: params.reason,
        handoffTaggedAt: taggedAt,
        status: ChatRoomStatus.ACTIVE,
        priority: PRIORITY_MAP[params.priority] ?? ChatPriority.NORMAL,
      },
      select: { customerId: true },
    });

    this.logger.warn(
      `[Handoff] roomId=${params.roomId} priority=${params.priority} reason="${params.reason}"`,
    );

    this.gateway?.emitRoomUpdate(params.roomId, {
      event: 'handoff',
      roomId: params.roomId,
      priority: params.priority,
      reason: params.reason,
      summary: params.summary,
    });

    // best-effort หลังเขียนห้องสำเร็จ: recordAfterCommit ไม่โยน · ห้องที่ยังไม่มีเจ้าของไม่มีลูกค้าให้ผูก จึงข้าม
    // PDPA: ห้ามส่ง params.summary (ข้อความลูกค้า) เข้าไป · reason ถูกแปลงเป็นรหัสปิดใน botHandoffEntry ไม่ลงแถว
    if (room.customerId) {
      await this.journey?.recordAfterCommit(
        botHandoffEntry({
          customerId: room.customerId,
          roomId: params.roomId,
          reason: params.reason,
          priority: params.priority,
          taggedAt,
        }),
      );
    }
  }

  /** Resolve handoff — staff is done, return to AI or mark IDLE */
  async resolveHandoff(
    roomId: string,
    resolveToAI = false,
  ): Promise<void> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true },
    });
    if (!room) throw new NotFoundException('ไม่พบห้องแชท');

    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        handoffMode: false,
        handoffReason: null,
        status: resolveToAI
          ? ChatRoomStatus.ACTIVE
          : ChatRoomStatus.IDLE,
        resolvedAt: resolveToAI ? undefined : new Date(),
      },
    });

    this.logger.log(
      `[Handoff] resolved roomId=${roomId} returnToAI=${resolveToAI}`,
    );
  }

  /** Check if a room is in handoff mode */
  async isInHandoffMode(roomId: string): Promise<boolean> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { handoffMode: true },
    });
    return room?.handoffMode ?? false;
  }
}
