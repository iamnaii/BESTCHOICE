import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatRoomStatus, ChatPriority } from '@prisma/client';
import { IChatGateway, CHAT_GATEWAY_TOKEN } from '../interfaces/chat-gateway.interface';

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
  ) {}

  /** Initiate handoff — mark room for staff pickup */
  async initiateHandoff(params: HandoffParams): Promise<void> {
    await this.prisma.chatRoom.update({
      where: { id: params.roomId },
      data: {
        handoffMode: true,
        handoffReason: params.reason,
        handoffTaggedAt: new Date(),
        status: ChatRoomStatus.ACTIVE,
        priority: PRIORITY_MAP[params.priority] ?? ChatPriority.NORMAL,
      },
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
  }

  /** Resolve handoff — staff is done, return to AI or mark IDLE */
  async resolveHandoff(
    roomId: string,
    resolveToAI = false,
  ): Promise<void> {
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
