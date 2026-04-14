import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatSessionStatus, ChatPriority } from '@prisma/client';
import { IChatGateway, CHAT_GATEWAY_TOKEN } from '../interfaces/chat-gateway.interface';

export interface HandoffParams {
  sessionId: string;
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

  /** Initiate handoff — mark session for staff pickup */
  async initiateHandoff(params: HandoffParams): Promise<void> {
    await this.prisma.chatSession.update({
      where: { id: params.sessionId },
      data: {
        handoffMode: true,
        handoffReason: params.reason,
        handoffTaggedAt: new Date(),
        sessionStatus: ChatSessionStatus.HANDOFF,
        priority: PRIORITY_MAP[params.priority] ?? ChatPriority.NORMAL,
      },
    });

    this.logger.warn(
      `[Handoff] sessionId=${params.sessionId} priority=${params.priority} reason="${params.reason}"`,
    );

    this.gateway?.emitSessionUpdate(params.sessionId, {
      event: 'handoff',
      sessionId: params.sessionId,
      priority: params.priority,
      reason: params.reason,
      summary: params.summary,
    });
  }

  /** Resolve handoff — staff is done, return to AI or close */
  async resolveHandoff(
    sessionId: string,
    resolveToAI = false,
  ): Promise<void> {
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        handoffMode: false,
        handoffReason: null,
        sessionStatus: resolveToAI
          ? ChatSessionStatus.OPEN
          : ChatSessionStatus.RESOLVED,
        resolvedAt: resolveToAI ? undefined : new Date(),
      },
    });

    this.logger.log(
      `[Handoff] resolved sessionId=${sessionId} returnToAI=${resolveToAI}`,
    );
  }

  /** Check if a session is in handoff mode */
  async isInHandoffMode(sessionId: string): Promise<boolean> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { handoffMode: true },
    });
    return session?.handoffMode ?? false;
  }
}
