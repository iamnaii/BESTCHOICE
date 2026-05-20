import { Injectable, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  IChatGateway,
  CHAT_GATEWAY_TOKEN,
} from '../../chat-engine/interfaces/chat-gateway.interface';

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
    await this.prisma.chatRoom.update({
      where: { id: input.roomId },
      data: {
        handoffMode: true,
        handoffReason: input.reason,
        handoffTaggedAt: new Date(),
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
