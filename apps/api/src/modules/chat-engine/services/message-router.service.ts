import { Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { ChatChannel, MessageRole, MessageType } from '@prisma/client';
import {
  IChannelAdapter,
  InboundMessage,
  CHANNEL_ADAPTER_TOKEN,
} from '../interfaces/channel-adapter.interface';
import {
  IDomainHandler,
  DomainContext,
  DOMAIN_HANDLER_TOKEN,
} from '../interfaces/domain-handler.interface';
import { RoomManagerService } from './room-manager.service';
import { HandoffManagerService } from './handoff-manager.service';
import { AfterHoursService } from './after-hours.service';
import { IChatGateway, CHAT_GATEWAY_TOKEN } from '../interfaces/chat-gateway.interface';
import { AiAutoReplyService } from '../../staff-chat/services/ai-auto-reply.service';

/**
 * MessageRouter — the central nerve of the chat engine.
 *
 * Receives normalized InboundMessages from channel adapters and routes them:
 * 1. If room is in handoff → skip AI, store message, notify staff via WS
 * 2. If room is active → find domain handler → get AI reply → send through adapter
 * 3. Handles room creation, message persistence, SLA tracking
 */
@Injectable()
export class MessageRouterService {
  private readonly logger = new Logger(MessageRouterService.name);
  private readonly adapterMap = new Map<ChatChannel, IChannelAdapter>();
  private readonly domainHandlers: IDomainHandler[] = [];

  constructor(
    private roomManager: RoomManagerService,
    private handoffManager: HandoffManagerService,
    @Optional()
    @Inject(forwardRef(() => AfterHoursService))
    private afterHoursService?: AfterHoursService,
    @Optional()
    private aiAutoReplyService?: AiAutoReplyService,
    @Optional()
    @Inject(CHANNEL_ADAPTER_TOKEN)
    adapters?: IChannelAdapter[],
    @Optional()
    @Inject(DOMAIN_HANDLER_TOKEN)
    handlers?: IDomainHandler[],
    @Optional()
    @Inject(CHAT_GATEWAY_TOKEN)
    private gateway?: IChatGateway,
  ) {
    // Register adapters by channel
    if (adapters) {
      for (const adapter of Array.isArray(adapters) ? adapters : [adapters]) {
        this.adapterMap.set(adapter.channel, adapter);
        this.logger.log(`Registered adapter: ${adapter.channel}`);
      }
    }

    // Register domain handlers
    if (handlers) {
      this.domainHandlers.push(
        ...(Array.isArray(handlers) ? handlers : [handlers]),
      );
      this.logger.log(
        `Registered ${this.domainHandlers.length} domain handler(s)`,
      );
    }
  }

  /**
   * Route an inbound message through the engine pipeline.
   *
   * Pipeline:
   * 1. Get/create room
   * 2. Save inbound message
   * 3. Check handoff mode → if yes, only notify staff
   * 3.5. Check AI auto-reply → if confident, send and return; if not, handoff
   * 4. Check after-hours → if yes, auto-reply and return
   * 5. Find domain handler for channel
   * 6. Process message → get reply
   * 7. Send reply through adapter
   * 8. Save outbound message
   */
  async routeInbound(message: InboundMessage): Promise<void> {
    // 0. Best-effort profile fetch — never block webhook on profile API issues
    const adapter = this.adapterMap.get(message.channel);
    let profile: { displayName?: string; avatarUrl?: string } | null = null;
    if (adapter?.getUserProfile) {
      try {
        profile = await adapter.getUserProfile(message.externalUserId);
      } catch (err) {
        this.logger.warn(
          `[${message.channel}] profile fetch threw: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // 1. Get or create room
    const room = await this.roomManager.getOrCreateRoom({
      externalUserId: message.externalUserId,
      channel: message.channel,
      displayName: profile?.displayName,
      pictureUrl: profile?.avatarUrl,
      attribution: message.attribution,
    });

    // 2. Save inbound message
    await this.roomManager.saveMessage({
      roomId: room.id,
      externalMessageId: message.externalMessageId,
      role: MessageRole.CUSTOMER,
      type: message.type,
      text: message.text,
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
    });

    // 3. Check handoff mode — if staff is handling, don't run AI
    if (room.handoffMode) {
      this.logger.debug(
        `Room ${room.id} in handoff mode — skipping AI processing`,
      );
      this.gateway?.emitNewMessage(room.id, {
        role: 'CUSTOMER',
        text: message.text,
        type: message.type,
        channel: message.channel,
        roomId: room.id,
      });
      return;
    }

    // 3.5 AI auto-reply — runs when auto mode is enabled for the room channel
    if (this.aiAutoReplyService && await this.aiAutoReplyService.shouldAutoReply(room)) {
      const customerMessage = message.text ?? '';
      try {
        const result = await this.aiAutoReplyService.autoReply(room.id, customerMessage);

        if (result !== null) {
          // AI is confident — send reply and skip further processing
          const adapter = this.adapterMap.get(message.channel);
          if (adapter) {
            await adapter.sendMessage({
              externalUserId: message.externalUserId,
              channel: message.channel,
              type: 'TEXT' as any,
              text: result.reply,
            });
            await this.roomManager.saveMessage({
              roomId: room.id,
              role: MessageRole.BOT,
              text: result.reply,
            });
          }
          await this.aiAutoReplyService.logAutoReply({
            roomId: room.id,
            customerMessage,
            aiReply: result.reply,
            confidence: result.confidence,
            autoSent: true,
          });
          this.logger.log(
            `[AiAutoReply] Replied to room ${room.id} with confidence=${result.confidence}`,
          );
          return;
        } else {
          // AI not confident — initiate handoff to staff
          await this.aiAutoReplyService.logAutoReply({
            roomId: room.id,
            customerMessage,
            aiReply: '',
            confidence: 0,
            autoSent: false,
            handoffReason: 'ความมั่นใจของ AI ต่ำกว่า threshold',
          });
          await this.handoffManager.initiateHandoff({
            roomId: room.id,
            reason: 'AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน',
            priority: 'normal',
            summary: customerMessage,
          });
          this.logger.log(
            `[AiAutoReply] Low confidence for room ${room.id} — initiated handoff`,
          );
          return;
        }
      } catch (err) {
        this.logger.error(
          `[AiAutoReply] Error for room ${room.id}: ${err instanceof Error ? err.message : err}`,
        );
        // Fall through to normal processing on error
      }
    }

    // 4. After-hours auto-reply (only reached when AI auto mode is off or errored)
    if (this.afterHoursService?.isAfterHours() && !room.handoffMode) {
      try {
        const reply = await this.afterHoursService.getAutoReply(
          message.text ?? '',
        );
        const adapter = this.adapterMap.get(message.channel);
        if (adapter) {
          await adapter.sendMessage({
            externalUserId: message.externalUserId,
            channel: message.channel,
            type: 'TEXT' as any,
            text: reply,
          });
          await this.roomManager.saveMessage({
            roomId: room.id,
            role: MessageRole.BOT,
            text: reply,
          });
        }
        this.logger.log(
          `[AfterHours] Auto-replied to room ${room.id}`,
        );
        return;
      } catch (err) {
        this.logger.error(
          `[AfterHours] Error: ${err instanceof Error ? err.message : err}`,
        );
        // Fall through to normal processing
      }
    }

    // 4. Find domain handler
    const handler = this.findDomainHandler(message.channel);
    if (!handler) {
      this.logger.warn(
        `No domain handler for channel ${message.channel} — message stored but not processed`,
      );
      return;
    }

    // 5. Build context and process
    const context: DomainContext = {
      room,
      message,
      isVerified: !!room.verifiedAt,
      isHandoff: room.handoffMode,
    };

    try {
      const result = await handler.handleMessage(context);

      // 6. Handle handoff request from domain handler
      if (result.shouldHandoff) {
        await this.handoffManager.initiateHandoff({
          roomId: room.id,
          reason: result.handoffReason ?? 'ลูกค้าขอพูดกับพนักงาน',
          priority: result.handoffPriority ?? 'normal',
          summary: message.text ?? '(media message)',
        });
      }

      // 7. Send replies through adapter and save them
      const adapter = this.adapterMap.get(message.channel);
      if (adapter && result.replies.length > 0) {
        for (const reply of result.replies) {
          const sendResult = await adapter.sendMessage(reply);

          await this.roomManager.saveMessage({
            roomId: room.id,
            externalMessageId: sendResult.externalMessageId,
            role: MessageRole.BOT,
            type: reply.type,
            text: reply.text,
          });

          if (!sendResult.success) {
            this.logger.error(
              `Failed to send reply on ${message.channel}: ${sendResult.error}`,
            );
          }
        }
      }

      // 8. Apply tags from domain handler
      if (result.tags?.length) {
        // Tags will be handled by ConversationTagService
        // For now, just log
        this.logger.debug(
          `Tags suggested for room ${room.id}: ${result.tags.join(', ')}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Error processing message for room ${room.id}: ${err instanceof Error ? err.message : err}`,
      );
      // Don't throw — message is already saved, failure is logged
    }
  }

  /**
   * Mirror an inbound message to ChatRoom/ChatMessage only — no AI, no
   * after-hours, no domain handler dispatch. Used by channel handlers that
   * own their own reply logic (e.g. Shop command-based bot) but want their
   * conversations visible in the Unified Inbox with platform profile.
   */
  async mirrorInbound(message: InboundMessage): Promise<void> {
    const adapter = this.adapterMap.get(message.channel);
    let profile: { displayName?: string; avatarUrl?: string } | null = null;
    if (adapter?.getUserProfile) {
      try {
        profile = await adapter.getUserProfile(message.externalUserId);
      } catch (err) {
        this.logger.warn(
          `[${message.channel}] profile fetch threw: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const room = await this.roomManager.getOrCreateRoom({
      externalUserId: message.externalUserId,
      channel: message.channel,
      displayName: profile?.displayName,
      pictureUrl: profile?.avatarUrl,
      attribution: message.attribution,
    });

    await this.roomManager.saveMessage({
      roomId: room.id,
      externalMessageId: message.externalMessageId,
      role: MessageRole.CUSTOMER,
      type: message.type,
      text: message.text,
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
    });

    // Emit to Unified Inbox (best-effort)
    this.gateway?.emitNewMessage(room.id, {
      role: 'CUSTOMER',
      text: message.text,
      type: message.type,
      channel: message.channel,
      roomId: room.id,
    });
  }

  /** Mirror an outbound (bot/staff) message to ChatRoom — for channels that send outside MessageRouter */
  async mirrorOutbound(params: {
    externalUserId: string;
    channel: ChatChannel;
    role: typeof MessageRole.BOT | typeof MessageRole.STAFF;
    text?: string;
    type?: MessageType;
    mediaUrl?: string;
    staffId?: string;
  }): Promise<void> {
    const room = await this.roomManager.getOrCreateRoom({
      externalUserId: params.externalUserId,
      channel: params.channel,
    });
    await this.roomManager.saveMessage({
      roomId: room.id,
      role: params.role,
      text: params.text,
      type: params.type,
      mediaUrl: params.mediaUrl,
      staffId: params.staffId,
    });
  }

  /** Send a staff message through the appropriate adapter */
  async sendStaffMessage(params: {
    roomId: string;
    staffId: string;
    text: string;
  }): Promise<void> {
    const room = await this.roomManager.findById(params.roomId);
    if (!room) {
      this.logger.error(`Room not found: ${params.roomId}`);
      return;
    }

    // Resolve the external user ID (externalUserId for FB/TikTok, lineUserId for LINE)
    const externalUserId =
      room.externalUserId ?? room.lineUserId ?? '';

    // Save the staff message
    await this.roomManager.saveMessage({
      roomId: params.roomId,
      role: MessageRole.STAFF,
      text: params.text,
      staffId: params.staffId,
    });

    // Send through adapter
    const adapter = this.adapterMap.get(room.channel);
    if (adapter) {
      const result = await adapter.sendMessage({
        externalUserId,
        channel: room.channel,
        type: 'TEXT' as any,
        text: params.text,
      });

      if (!result.success) {
        this.logger.error(
          `Failed to send staff message on ${room.channel}: ${result.error}`,
        );
      }
    }
  }

  /** Get registered adapter for a channel */
  getAdapter(channel: ChatChannel): IChannelAdapter | undefined {
    return this.adapterMap.get(channel);
  }

  /** Find domain handler that supports the given channel */
  private findDomainHandler(channel: ChatChannel): IDomainHandler | undefined {
    return this.domainHandlers.find((h) => h.supportsChannel(channel));
  }
}
