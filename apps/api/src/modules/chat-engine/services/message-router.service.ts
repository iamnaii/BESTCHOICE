import { Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { ChatChannel, ChatSessionStatus, MessageRole } from '@prisma/client';
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
import { SessionManagerService } from './session-manager.service';
import { HandoffManagerService } from './handoff-manager.service';
import { AfterHoursService } from './after-hours.service';
import { IChatGateway, CHAT_GATEWAY_TOKEN } from '../interfaces/chat-gateway.interface';

/**
 * MessageRouter — the central nerve of the chat engine.
 *
 * Receives normalized InboundMessages from channel adapters and routes them:
 * 1. If session is in handoff → skip AI, store message, notify staff via WS
 * 2. If session is active → find domain handler → get AI reply → send through adapter
 * 3. Handles session creation, message persistence, SLA tracking
 */
@Injectable()
export class MessageRouterService {
  private readonly logger = new Logger(MessageRouterService.name);
  private readonly adapterMap = new Map<ChatChannel, IChannelAdapter>();
  private readonly domainHandlers: IDomainHandler[] = [];

  constructor(
    private sessionManager: SessionManagerService,
    private handoffManager: HandoffManagerService,
    @Optional()
    @Inject(forwardRef(() => AfterHoursService))
    private afterHoursService?: AfterHoursService,
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
   * 1. Get/create session
   * 2. Save inbound message
   * 3. Check handoff mode → if yes, only notify staff
   * 4. Find domain handler for channel
   * 5. Process message → get reply
   * 6. Send reply through adapter
   * 7. Save outbound message
   */
  async routeInbound(message: InboundMessage): Promise<void> {
    // 1. Get or create session
    const session = await this.sessionManager.getOrCreateSession({
      externalUserId: message.externalUserId,
      channel: message.channel,
    });

    // 2. Save inbound message
    await this.sessionManager.saveMessage({
      sessionId: session.id,
      externalMessageId: message.externalMessageId,
      role: MessageRole.CUSTOMER,
      type: message.type,
      text: message.text,
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
    });

    // 3. Check handoff mode — if staff is handling, don't run AI
    if (session.handoffMode) {
      this.logger.debug(
        `Session ${session.id} in handoff mode — skipping AI processing`,
      );
      this.gateway?.emitNewMessage(session.id, {
        role: 'CUSTOMER',
        text: message.text,
        type: message.type,
        channel: message.channel,
        sessionId: session.id,
      });
      return;
    }

    // 3.5 After-hours auto-reply
    if (this.afterHoursService?.isAfterHours() && !session.handoffMode) {
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
          await this.sessionManager.saveMessage({
            sessionId: session.id,
            role: MessageRole.BOT,
            text: reply,
          });
        }
        this.logger.log(
          `[AfterHours] Auto-replied to session ${session.id}`,
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
      session,
      message,
      isVerified: !!session.verifiedAt,
      isHandoff: session.handoffMode,
    };

    try {
      const result = await handler.handleMessage(context);

      // 6. Handle handoff request from domain handler
      if (result.shouldHandoff) {
        await this.handoffManager.initiateHandoff({
          sessionId: session.id,
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

          await this.sessionManager.saveMessage({
            sessionId: session.id,
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
          `Tags suggested for session ${session.id}: ${result.tags.join(', ')}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Error processing message for session ${session.id}: ${err instanceof Error ? err.message : err}`,
      );
      // Don't throw — message is already saved, failure is logged
    }
  }

  /** Send a staff message through the appropriate adapter */
  async sendStaffMessage(params: {
    sessionId: string;
    staffId: string;
    text: string;
  }): Promise<void> {
    const session = await this.sessionManager.findById(params.sessionId);
    if (!session) {
      this.logger.error(`Session not found: ${params.sessionId}`);
      return;
    }

    // Resolve the external user ID
    const externalUserId =
      session.externalUserId || session.lineUserId;

    // Save the staff message
    await this.sessionManager.saveMessage({
      sessionId: params.sessionId,
      role: MessageRole.STAFF,
      text: params.text,
      staffId: params.staffId,
    });

    // Send through adapter
    const adapter = this.adapterMap.get(session.channel);
    if (adapter) {
      const result = await adapter.sendMessage({
        externalUserId,
        channel: session.channel,
        type: 'TEXT' as any,
        text: params.text,
      });

      if (!result.success) {
        this.logger.error(
          `Failed to send staff message on ${session.channel}: ${result.error}`,
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
