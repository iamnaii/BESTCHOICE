import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { reason: string; roomId: string }) {
    await this.prisma.chatRoom.update({
      where: { id: input.roomId },
      data: {
        handoffMode: true,
        handoffReason: input.reason,
        handoffTaggedAt: new Date(),
      },
    });
    return { handoffAccepted: true };
  }
}
