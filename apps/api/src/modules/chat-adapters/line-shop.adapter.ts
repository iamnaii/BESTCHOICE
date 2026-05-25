import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import {
  IChannelAdapter,
  OutboundMessage,
  OutboundQuickReply,
  SendResult,
  UserProfile,
} from '../chat-engine/interfaces/channel-adapter.interface';
import { parseStickerToken } from '../chat-engine/utils/sticker-token.util';
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
      const payload = this.buildLinePayload(message);
      if (!payload) {
        return { success: true };
      }
      // The local LineMessagePayload union covers text/flex/sticker only,
      // but the LINE Messaging API itself accepts image/video/location too.
      // Cast through unknown so the broader payload reaches the API unchanged.
      await this.lineOaService.pushMessage(
        message.externalUserId,
        [payload as unknown as LineMessagePayload],
        'line-shop',
      );
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[LineShopAdapter] send failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /** See LineFinanceAdapter — identical payload shape; LINE API is shared. */
  private buildLinePayload(message: OutboundMessage): Record<string, unknown> | undefined {
    const quickReply =
      message.quickReplies && message.quickReplies.length > 0
        ? { items: this.buildLineQuickReplyItems(message.quickReplies) }
        : undefined;
    const withQr = <T extends Record<string, unknown>>(payload: T): T =>
      quickReply ? ({ ...payload, quickReply } as T) : payload;

    if (message.imageUrl) {
      return withQr({
        type: 'image',
        originalContentUrl: message.imageUrl,
        previewImageUrl: message.thumbnailUrl ?? message.imageUrl,
      });
    }
    if (message.sticker) {
      return withQr({
        type: 'sticker',
        packageId: message.sticker.packageId,
        stickerId: message.sticker.stickerId,
      });
    }
    if (message.location) {
      return withQr({
        type: 'location',
        title: message.location.title,
        address: message.location.address,
        latitude: message.location.latitude,
        longitude: message.location.longitude,
      });
    }
    if (message.videoUrl) {
      return withQr({
        type: 'video',
        originalContentUrl: message.videoUrl,
        previewImageUrl: message.thumbnailUrl ?? message.videoUrl,
      });
    }
    if (message.flexJson) {
      return withQr({
        type: 'flex',
        altText: (message.flexJson as any)?.altText ?? 'Flex message',
        contents: message.flexJson,
      });
    }
    if (message.jsonPayload) {
      const raw = { ...(message.jsonPayload as Record<string, unknown>) };
      if (quickReply && !raw.quickReply) raw.quickReply = quickReply;
      return raw;
    }
    if (message.text) {
      const sticker = parseStickerToken(message.text);
      if (sticker) {
        return withQr({
          type: 'sticker',
          packageId: sticker.packageId,
          stickerId: sticker.stickerId,
        });
      }
      return withQr({ type: 'text', text: message.text });
    }
    return undefined;
  }

  private buildLineQuickReplyItems(qrs: OutboundQuickReply[]): Array<Record<string, unknown>> {
    return qrs.slice(0, 13).map((q) => {
      let action: Record<string, unknown>;
      if (q.type === 'URL') {
        action = { type: 'uri', label: q.label, uri: q.url ?? '' };
      } else if (q.type === 'MESSAGE') {
        action = { type: 'message', label: q.label, text: q.message ?? q.label };
      } else {
        action = { type: 'postback', label: q.label, data: q.payload ?? '' };
      }
      return { type: 'action', action };
    });
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
