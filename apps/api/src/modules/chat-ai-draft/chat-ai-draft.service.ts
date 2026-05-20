import { Injectable, Logger, NotFoundException, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatIntentRouterService } from '../chat-intent-router/chat-intent-router.service';
import { SalesBotService } from '../sales-bot/sales-bot.service';
import { FinanceAiService } from '../chatbot-finance/services/finance-ai.service';
import { LineFinanceClientService } from '../chatbot-finance/services/line-finance-client.service';
import {
  IChatGateway,
  CHAT_GATEWAY_TOKEN,
} from '../chat-engine/interfaces/chat-gateway.interface';

@Injectable()
export class ChatAiDraftService {
  private readonly logger = new Logger(ChatAiDraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: ChatIntentRouterService,
    private readonly salesBot: SalesBotService,
    private readonly financeAi: FinanceAiService,
    private readonly lineClient: LineFinanceClientService,
    @Optional()
    @Inject(CHAT_GATEWAY_TOKEN)
    private readonly gateway?: IChatGateway,
  ) {}

  async generateDraft(inboundMessageId: string): Promise<{ draftMessageId: string }> {
    const inbound = await this.prisma.chatMessage.findUnique({
      where: { id: inboundMessageId },
      include: { room: true },
    });
    if (!inbound || !inbound.text) throw new NotFoundException('inbound message not found');
    if (inbound.room.aiPaused || inbound.room.handoffMode) {
      this.logger.log(`Room ${inbound.room.id} AI paused/handoff — skipping draft`);
      return { draftMessageId: '' };
    }

    // Check AiSettings mode (singleton row)
    const settings = await this.prisma.aiSettings.findUnique({ where: { id: 'singleton' } });

    const priorMessages = await this.loadPrior(inbound.roomId, 3);
    const routed = await this.router.classify({
      text: inbound.text,
      roomId: inbound.roomId,
      customerId: inbound.room.customerId,
      priorMessages,
    });

    // Enforce per-bot AiSettings mode
    if (settings) {
      const mode = routed.routeTo === 'sales' ? settings.salesBotMode : settings.serviceBotMode;
      if (mode === 'OFF') {
        this.logger.log(`Bot ${routed.routeTo} is OFF — no draft generated`);
        return { draftMessageId: '' };
      }
    }

    let reply = '';
    let confidence = routed.confidence;
    let toolsUsed: string[] = [];
    let modelUsed = 'claude-sonnet-4-6';
    let inputTokens = 0;
    let outputTokens = 0;

    if (routed.routeTo === 'sales') {
      const r = await this.salesBot.generateReply({
        text: inbound.text,
        roomId: inbound.roomId,
        customerId: inbound.room.customerId,
        priorMessages: priorMessages.map((m) => ({
          role: m.role === 'STAFF' ? ('assistant' as const) : ('user' as const),
          content: m.text,
        })),
      });
      reply = r.reply;
      confidence = r.confidence;
      toolsUsed = r.toolsUsed;
      inputTokens = r.inputTokens;
      outputTokens = r.outputTokens;
    } else if (routed.routeTo === 'service') {
      // FinanceAiService.generateReply signature: { userMessage, history, customerId, customerName, roomId }
      // Returns AiReply | null with { text, model, inputTokens, outputTokens, toolsUsed, handoffTriggered }
      // customerId is required — if room has no customer, fallback to handoff.
      if (!inbound.room.customerId) {
        await this.prisma.chatRoom.update({
          where: { id: inbound.roomId },
          data: {
            handoffMode: true,
            handoffReason: 'service_no_customer',
            handoffTaggedAt: new Date(),
          },
        });
        return { draftMessageId: '' };
      }
      const customer = await this.prisma.customer.findUnique({
        where: { id: inbound.room.customerId },
        select: { name: true, nickname: true },
      });
      const customerName = customer?.nickname || customer?.name || 'ลูกค้า';
      const r = await this.financeAi.generateReply({
        userMessage: inbound.text,
        history: [],
        customerId: inbound.room.customerId,
        customerName,
        roomId: inbound.roomId,
      });
      if (!r) {
        this.logger.warn(`FinanceAI returned null for room ${inbound.roomId} — handoff`);
        await this.prisma.chatRoom.update({
          where: { id: inbound.roomId },
          data: {
            handoffMode: true,
            handoffReason: 'finance_ai_unavailable',
            handoffTaggedAt: new Date(),
          },
        });
        return { draftMessageId: '' };
      }
      reply = r.text;
      toolsUsed = r.toolsUsed ?? [];
      modelUsed = r.model;
      inputTokens = r.inputTokens;
      outputTokens = r.outputTokens;
    } else {
      await this.prisma.chatRoom.update({
        where: { id: inbound.roomId },
        data: { handoffMode: true, handoffReason: 'router_handoff', handoffTaggedAt: new Date() },
      });
      return { draftMessageId: '' };
    }

    const draft = await this.prisma.chatMessage.create({
      data: {
        roomId: inbound.roomId,
        role: 'BOT',
        type: 'TEXT',
        text: reply,
        intent: `DRAFT:${routed.intent}`,
        confidence,
        toolsUsed,
        modelUsed,
        inputTokens,
        outputTokens,
      },
    });
    return { draftMessageId: draft.id };
  }

  async approveDraft(
    draftMessageId: string,
    approverId: string,
    editedText?: string,
  ): Promise<{ sent: boolean }> {
    const draft = await this.prisma.chatMessage.findUnique({
      where: { id: draftMessageId },
      include: { room: true },
    });
    if (!draft) throw new NotFoundException('draft not found');

    const finalText = editedText ?? draft.text ?? '';
    const lineUserId = draft.room.lineUserId;
    if (draft.room.channel === 'LINE_FINANCE' && lineUserId) {
      // LineFinanceClientService.pushText(to, text) — wraps pushMessage with text payload.
      await this.lineClient.pushText(lineUserId, finalText);
    }
    // Facebook send client comes in Task 10 webhook wiring — for Week 1 FB drafts store-only.

    await this.prisma.chatMessage.update({
      where: { id: draftMessageId },
      data: {
        text: finalText,
        intent: draft.intent?.replace(/^DRAFT:/, '') ?? null,
        deliveredAt: new Date(),
        staffId: approverId,
      },
    });
    return { sent: true };
  }

  async skipDraft(draftMessageId: string, skipperId: string): Promise<{ skipped: boolean }> {
    await this.prisma.chatMessage.update({
      where: { id: draftMessageId },
      data: { deletedAt: new Date(), staffId: skipperId },
    });
    return { skipped: true };
  }

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
    return { released: true };
  }

  private async loadPrior(roomId: string, n: number) {
    const rows = await this.prisma.chatMessage.findMany({
      where: { roomId, deletedAt: null, text: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: n,
      select: { role: true, text: true },
    });
    return rows.reverse().map((r) => ({
      role:
        r.role === 'STAFF' || r.role === 'BOT' ? ('STAFF' as const) : ('CUSTOMER' as const),
      text: r.text ?? '',
    }));
  }
}
