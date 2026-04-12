import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, MessageType } from '@prisma/client';
import {
  IChannelAdapter,
  OutboundMessage,
  SendResult,
  UserProfile,
} from '../chat-engine/interfaces/channel-adapter.interface';
import { LineOaService } from '../line-oa/line-oa.service';

/**
 * LINE Shop adapter — wraps LineOaService (Shop OA)
 * to conform to IChannelAdapter for the unified chat engine.
 */
@Injectable()
export class LineShopAdapter implements IChannelAdapter {
  readonly channel = ChatChannel.LINE_SHOP;
  private readonly logger = new Logger(LineShopAdapter.name);

  constructor(private lineOaService: LineOaService) {}

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    try {
      if (message.text) {
        await this.lineOaService.pushMessage(message.externalUserId, [
          { type: 'text', text: message.text },
        ]);
      }
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[LineShopAdapter] send failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  async sendTypingIndicator(_externalUserId: string): Promise<void> {
    // LINE doesn't support typing indicators from bots
  }

  async getUserProfile(_externalUserId: string): Promise<UserProfile | null> {
    return null;
  }
}
