import { Injectable, Logger, Inject, Optional, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatRoomStatus, ChatPriority } from '@prisma/client';
import { IChatGateway, CHAT_GATEWAY_TOKEN } from '../interfaces/chat-gateway.interface';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { botHandoffEntry } from '../../customer-journey/chat-identity-entries';
import {
  BOT_STAFF_ATTENTION_PREFIX,
  hasPendingBotStaffAttention,
  mergeWithBotStaffAttention,
} from '../constants/bot-staff-attention';

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

const PRIORITY_RANK: Record<ChatPriority, number> = {
  [ChatPriority.LOW]: 0,
  [ChatPriority.NORMAL]: 1,
  [ChatPriority.HIGH]: 2,
  [ChatPriority.CRITICAL]: 3,
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
    // คำขอของบอทที่ยังค้าง (notify_staff — ไม่ตั้ง handoffMode แต่ปักเหตุผล + ความด่วน HIGH) ต้องไม่ถูก
    // เขียนทับด้วยการส่งต่อรอบนี้ (เช่น เทิร์นถัดไปความมั่นใจต่ำ → "AI ไม่มั่นใจ" ลบ "ลูกค้าขอดูรูปเครื่องจริง"
    // และลดป้าย "ด่วน" เป็น NORMAL) — ต่อท้ายเหตุผล และไม่ลดความด่วนของห้องที่มีคำขอค้าง
    // best-effort: อ่านไม่ได้ = ใช้ค่าของรอบนี้ตามเดิม ห้ามทำให้การส่งต่อพนักงานล้ม
    let storedReason = params.reason;
    let priority = PRIORITY_MAP[params.priority] ?? ChatPriority.NORMAL;
    try {
      const current = await this.prisma.chatRoom.findUnique({
        where: { id: params.roomId },
        select: { handoffMode: true, handoffReason: true, handoffTaggedAt: true, priority: true },
      });
      if (hasPendingBotStaffAttention(current, taggedAt)) {
        storedReason = mergeWithBotStaffAttention(params.reason, current, taggedAt);
        if (current?.priority && PRIORITY_RANK[current.priority] > PRIORITY_RANK[priority]) {
          priority = current.priority;
        }
      }
    } catch {
      storedReason = params.reason;
    }
    const room = await this.prisma.chatRoom.update({
      where: { id: params.roomId },
      data: {
        handoffMode: true,
        handoffReason: storedReason,
        handoffTaggedAt: taggedAt,
        status: ChatRoomStatus.ACTIVE,
        priority,
      },
      select: { customerId: true },
    });

    this.logger.warn(
      `[Handoff] roomId=${params.roomId} priority=${params.priority} reason="${storedReason}"`,
    );

    this.gateway?.emitRoomUpdate(params.roomId, {
      event: 'handoff',
      roomId: params.roomId,
      priority: params.priority,
      reason: storedReason,
      summary: params.summary,
    });

    // best-effort หลังเขียนห้องสำเร็จ: recordAfterCommit ไม่โยน · ห้องที่ยังไม่มีเจ้าของไม่มีลูกค้าให้ผูก จึงข้าม
    // PDPA: ห้ามส่ง params.summary (ข้อความลูกค้า) เข้าไป · reason ถูกแปลงเป็นรหัสปิดใน botHandoffEntry ไม่ลงแถว
    // รหัสเหตุผลคิดจาก params.reason (ข้อความตายตัวของผู้เรียก) ไม่ใช่ storedReason ที่ต่อคำขอของบอทไว้ —
    // handoffReasonCode จับคู่ข้อความตรงตัว ต่อท้ายแล้วจะตกเป็น OTHER
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
      select: { id: true, handoffReason: true, priority: true },
    });
    if (!room) throw new NotFoundException('ไม่พบห้องแชท');

    // ป้าย "ด่วน" ที่ notify_staff ยกไว้ (หรือที่ initiateHandoff คงไว้ตอน merge คำขอของบอท)
    // ต้องลงเมื่อเรื่องถูกปิด — ไม่งั้นทุกห้องที่บอทเคยขอให้ตามเรื่องจะค้างเป็น "ด่วน" ตลอดไป
    // (รีวิว SB-V1) · เทียบด้วย includes ไม่ใช่ startsWith เพราะ mergeWithBotStaffAttention
    // ต่อคำขอของบอทไว้ "ท้าย" เหตุผลของรอบส่งต่อ · CRITICAL ไม่ลด
    const clearsBotAttention =
      room.priority === ChatPriority.HIGH &&
      !!room.handoffReason?.includes(BOT_STAFF_ATTENTION_PREFIX);

    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        handoffMode: false,
        handoffReason: null,
        ...(clearsBotAttention ? { priority: ChatPriority.NORMAL } : {}),
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
