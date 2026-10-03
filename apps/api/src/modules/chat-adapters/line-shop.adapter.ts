import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import {
  IChannelAdapter,
  OutboundMessage,
  SendResult,
  UserProfile,
} from '../chat-engine/interfaces/channel-adapter.interface';
import { buildLinePayload } from './line-payload';
import { LineOaService } from '../line-oa/line-oa.service';
import type { LineMessagePayload } from '../line-oa/dto/webhook-event.dto';

/**
 * LINE Shop adapter — wraps LineOaService (Shop OA) to conform to
 * IChannelAdapter for the unified chat engine.
 *
 * Phase 4 multi-bubble: handles image/sticker/location/video/flex/json
 * in addition to text, with quick replies attached to any of them.
 */
@Injectable()
export class LineShopAdapter implements IChannelAdapter {
  readonly channel = ChatChannel.LINE_SHOP;
  private readonly logger = new Logger(LineShopAdapter.name);

  constructor(private lineOaService: LineOaService) {}

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    try {
      const payload = buildLinePayload(message);
      if (!payload) {
        return { success: true };
      }
      // The local LineMessagePayload union covers text/flex/sticker only,
      // but the LINE Messaging API itself accepts image/video/location too.
      // Cast through unknown so the broader payload reaches the API unchanged.
      const messages = [payload as unknown as LineMessagePayload];

      // Reply-token-first: reply API ฟรี, push กินโควต้า plan รายเดือน.
      // Token ใช้ครั้งเดียว/หมดอายุ ~60 วิ — fail แล้ว fallback เป็น push เสมอ
      if (message.replyToken) {
        try {
          await this.lineOaService.replyMessage(message.replyToken, messages, 'line-shop');
          return { success: true };
        } catch (err) {
          this.logger.warn(
            `[LineShopAdapter] reply failed — falling back to push: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      await this.lineOaService.pushMessage(message.externalUserId, messages, 'line-shop');
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

  async getUserProfile(externalUserId: string): Promise<UserProfile | null> {
    // LineOaService.getUserProfile throws on any failure — wrap so webhook never blocks
    try {
      const profile = await this.lineOaService.getUserProfile(externalUserId, 'line-shop');
      return {
        displayName: profile.displayName,
        avatarUrl: profile.pictureUrl,
      };
    } catch (err) {
      this.logger.warn(
        `[LineShopAdapter] profile fetch failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
