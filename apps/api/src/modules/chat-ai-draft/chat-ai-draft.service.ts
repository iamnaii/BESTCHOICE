import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageRole, MessageType } from '@prisma/client';
import { IChatGateway, CHAT_GATEWAY_TOKEN } from '../chat-engine/interfaces/chat-gateway.interface';

/**
 * Take-over / release-to-AI controls for the staff inboxes.
 * WS1 (2026-07): the legacy draft pipeline (generateDraft/approve/skip) was retired —
 * live bots (AiAutoReplyService บน SHOP channels, ChatbotFinance บน LINE_FINANCE)
 * เป็นคนตอบลูกค้าแล้ว เหลือเฉพาะปุ่มรับช่วงต่อ/ส่งกลับ AI
 */
@Injectable()
export class ChatAiDraftService {
  private readonly logger = new Logger(ChatAiDraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(CHAT_GATEWAY_TOKEN)
    private readonly gateway?: IChatGateway,
  ) {}

  async takeOver(roomId: string, staffId: string): Promise<{ paused: boolean }> {
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        aiPaused: true,
        aiPausedAt: new Date(),
        aiPausedById: staffId,
        assignedToId: staffId,
      },
    });
    // Real-time refresh — ConversationList in UnifiedInboxPage listens for
    // chat:room:update and invalidates ['chat-rooms']. Without this emit
    // the AI badge/filter chips stay stale until the user clicks refresh.
    this.gateway?.emitRoomUpdate(roomId, {
      roomId,
      aiPaused: true,
      aiPausedById: staffId,
    });
    await this.systemNote(roomId, async () => `${await this.staffName(staffId)} รับช่วงจากบอท — บอทหยุดตอบห้องนี้`);
    return { paused: true };
  }

  async releaseToAi(roomId: string, staffId: string): Promise<{ released: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      await tx.chatRoom.update({
        where: { id: roomId },
        data: { aiPaused: false, aiPausedAt: null, aiPausedById: null },
      });
      await tx.auditLog.create({
        data: {
          userId: staffId,
          action: 'AI_RELEASED',
          entity: 'chat_room',
          entityId: roomId,
        },
      });
    });
    this.gateway?.emitRoomUpdate(roomId, {
      roomId,
      aiPaused: false,
    });
    this.logger.log(`Room ${roomId} released back to AI by staff ${staffId}`);
    await this.systemNote(roomId, async () => `คืนให้บอทตอบ โดย ${await this.staffName(staffId)}`);
    return { released: true };
  }

  private async staffName(staffId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({ where: { id: staffId }, select: { name: true } });
    return u?.name || 'พนักงาน';
  }

  /**
   * ข้อความระบบในกระทู้ "ใครทำอะไรกับห้องนี้" — เขียนตรงลง chat_messages แบบเงียบ
   * (ไม่ผ่าน saveMessage จึงไม่แตะ lastMessageAt/totalMessages/unread — ห้องไม่เด้ง พรีวิวไม่เปลี่ยน)
   * best-effort: ล้มแล้วแค่ log ไม่ทำให้ take-over/release ล้ม
   */
  private async systemNote(roomId: string, build: () => Promise<string>): Promise<void> {
    try {
      const text = await build();
      await this.prisma.chatMessage.create({
        data: { roomId, role: MessageRole.SYSTEM, type: MessageType.TEXT, text },
      });
      this.gateway?.emitNewMessage(roomId, { role: 'SYSTEM', text, type: MessageType.TEXT, roomId });
    } catch (err) {
      this.logger.warn(`[system note] ${roomId}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
