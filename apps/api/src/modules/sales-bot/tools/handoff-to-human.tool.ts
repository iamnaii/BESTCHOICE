import { Injectable, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  IChatGateway,
  CHAT_GATEWAY_TOKEN,
} from '../../chat-engine/interfaces/chat-gateway.interface';
import { mergeWithBotStaffAttention } from '../../chat-engine/constants/bot-staff-attention';

export const HANDOFF_TO_HUMAN_TOOL = {
  name: 'handoff_to_human',
  description:
    'Escalate to a human staff member. Use when customer wants to negotiate, asks for a person, or the bot is uncertain.',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
      roomId: { type: 'string' },
    },
    required: ['reason', 'roomId'],
  },
};

@Injectable()
export class HandoffToHumanTool {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(CHAT_GATEWAY_TOKEN)
    private readonly gateway?: IChatGateway,
  ) {}

  async run(input: { reason: string; roomId: string }) {
    const taggedAt = new Date();
    // คำขอของบอทที่ยังค้าง (notify_staff — "[บอทขอให้พนักงานตามต่อ] ขอดูรูปเครื่องจริง …") ต้องไม่ถูกเขียนทับ
    // ด้วยเหตุผลของการส่งต่อรอบนี้ ("info_request") — พอ handoffMode = true แล้ว HandoffManager ไม่ได้ merge
    // ให้อีก พนักงานจึงไม่เห็นว่าบอทขออะไรไว้ (รีวิว RT-X5) · best-effort: อ่านไม่ได้ = ใช้เหตุผลรอบนี้ตามเดิม
    let storedReason = input.reason;
    try {
      const current = await this.prisma.chatRoom.findUnique({
        where: { id: input.roomId },
        select: { handoffMode: true, handoffReason: true, handoffTaggedAt: true },
      });
      storedReason = mergeWithBotStaffAttention(input.reason, current, taggedAt);
    } catch {
      storedReason = input.reason;
    }
    await this.prisma.chatRoom.update({
      where: { id: input.roomId },
      data: {
        handoffMode: true,
        handoffReason: storedReason,
        handoffTaggedAt: taggedAt,
      },
    });
    // Real-time refresh so the "ต้องตอบ" badge + "รอตอบ" filter chip
    // light up in UnifiedInboxPage's ConversationList immediately.
    this.gateway?.emitRoomUpdate(input.roomId, {
      roomId: input.roomId,
      handoffMode: true,
    });
    return { handoffAccepted: true };
  }
}
