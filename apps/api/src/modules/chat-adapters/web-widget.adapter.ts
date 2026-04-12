import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import {
  IChannelAdapter,
  OutboundMessage,
  SendResult,
  UserProfile,
} from '../chat-engine/interfaces/channel-adapter.interface';

/**
 * Web widget adapter — sends messages via WebSocket (no external API).
 *
 * Web visitors chat through a widget embedded on the website.
 * Messages are relayed through the Staff Chat WebSocket gateway
 * (Phase 2 Agent C). This adapter just marks messages as "sent"
 * since the WS gateway handles actual delivery.
 */
@Injectable()
export class WebWidgetAdapter implements IChannelAdapter {
  readonly channel = ChatChannel.WEB;
  private readonly logger = new Logger(WebWidgetAdapter.name);

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    // Web widget messages are delivered via WebSocket gateway,
    // not through an external API. The gateway emits to the
    // visitor's socket room. We just return success here.
    this.logger.debug(`[WebWidget] message queued for WS delivery to ${message.externalUserId}`);
    return { success: true };
  }

  async sendTypingIndicator(_externalUserId: string): Promise<void> {
    // Handled by WS gateway
  }

  async getUserProfile(_externalUserId: string): Promise<UserProfile | null> {
    // Web visitors don't have profiles until they identify themselves
    return null;
  }
}
