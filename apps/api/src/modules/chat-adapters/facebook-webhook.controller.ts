import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  HttpCode,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { InboundMessage } from '../chat-engine/interfaces/channel-adapter.interface';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ChatChannel, MessageType } from '@prisma/client';

/**
 * Facebook Messenger Webhook Controller
 *
 * Handles two Facebook webhook flows:
 * 1. GET  — Verification challenge (Facebook sends hub.challenge on setup)
 * 2. POST — Inbound message/postback events (HMAC-SHA256 signed)
 *
 * Security:
 * - GET verification uses FB_VERIFY_TOKEN (shared secret set in FB App dashboard)
 * - POST payloads verified via HMAC-SHA256 using FB_APP_SECRET
 * - Returns 200 immediately; Facebook retries on non-2xx after timeout
 *
 * This controller is intentionally public (no JwtAuthGuard) — it receives
 * external webhook calls from Facebook's infrastructure.
 */
@Controller('webhooks/facebook')
export class FacebookWebhookController {
  private readonly logger = new Logger(FacebookWebhookController.name);

  constructor(
    private messageRouter: MessageRouterService,
    private configService: ConfigService,
  ) {}

  /**
   * Webhook verification — Facebook sends GET with hub.challenge on setup.
   * Must return the challenge value as plain text if verify_token matches.
   */
  @Get()
  @SkipCsrf()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const verifyToken = this.configService.get<string>('FB_VERIFY_TOKEN');
    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('[FB Webhook] Verification succeeded');
      return challenge;
    }
    this.logger.warn(`[FB Webhook] Verification failed — mode=${mode}`);
    throw new BadRequestException('Verification failed');
  }

  /**
   * Inbound messages — Facebook sends POST with messaging events.
   *
   * Payload shape:
   * { object: 'page', entry: [{ id, time, messaging: [{ sender, recipient, timestamp, message? }] }] }
   *
   * We return 'EVENT_RECEIVED' immediately and process async.
   * Errors per-message are caught so one bad event doesn't fail the batch.
   */
  @Post()
  @SkipCsrf()
  @HttpCode(200)
  async handleWebhook(
    @Body() body: any,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<string> {
    // 1. Verify HMAC-SHA256 signature
    if (!this.verifySignature(body, signature)) {
      this.logger.warn('[FB Webhook] Invalid signature — rejecting payload');
      throw new BadRequestException('Invalid signature');
    }

    // 2. Only process page subscription events
    if (body.object !== 'page') {
      this.logger.warn(`[FB Webhook] Unexpected object type: ${body.object}`);
      return 'EVENT_RECEIVED';
    }

    // 3. Parse messaging entries
    const entries: any[] = body.entry ?? [];
    for (const entry of entries) {
      const messagingEvents: any[] = entry.messaging ?? [];

      for (const event of messagingEvents) {
        try {
          await this.processMessagingEvent(event);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `[FB Webhook] Error processing event from sender ${event?.sender?.id}: ${errorMsg}`,
          );
          // Don't throw — process remaining events
        }
      }
    }

    return 'EVENT_RECEIVED';
  }

  /**
   * Process a single messaging event from Facebook.
   * Supports: text messages, attachments (image/audio/video/file).
   * Ignores: read receipts, delivery confirmations, echoes.
   */
  private async processMessagingEvent(event: any): Promise<void> {
    const senderId: string | undefined = event.sender?.id;
    const message = event.message;

    // Skip echo messages (sent by our page), delivery, and read events
    if (!senderId || !message || message.is_echo) {
      return;
    }

    const { type, text, mediaUrl } = this.parseMessage(message);

    const inbound: InboundMessage = {
      externalMessageId: message.mid,
      externalUserId: senderId,
      channel: ChatChannel.FACEBOOK,
      type,
      text: text ?? undefined,
      mediaUrl: mediaUrl ?? undefined,
      rawPayload: event,
      timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
    };

    this.logger.log(
      `[FB Webhook] Inbound ${type} from PSID ${senderId} (mid: ${message.mid})`,
    );

    await this.messageRouter.routeInbound(inbound);
  }

  /**
   * Parse a Facebook message object into type + text + mediaUrl.
   *
   * Facebook attachment types: image, audio, video, file, fallback, template, location
   * Maps to our MessageType enum.
   */
  private parseMessage(message: any): {
    type: MessageType;
    text: string | null;
    mediaUrl: string | null;
  } {
    // Text message
    if (message.text) {
      return { type: MessageType.TEXT, text: message.text, mediaUrl: null };
    }

    // Attachment message — use first attachment
    const attachment = message.attachments?.[0];
    if (!attachment) {
      return { type: MessageType.TEXT, text: '[unsupported message]', mediaUrl: null };
    }

    const attachmentTypeMap: Record<string, MessageType> = {
      image: MessageType.IMAGE,
      audio: MessageType.AUDIO,
      video: MessageType.VIDEO,
      file: MessageType.FILE,
      location: MessageType.LOCATION,
    };

    const type = attachmentTypeMap[attachment.type] ?? MessageType.FILE;
    const mediaUrl = attachment.payload?.url ?? null;

    // Location has coordinates instead of URL
    if (attachment.type === 'location') {
      const coords = attachment.payload?.coordinates;
      const text = coords
        ? `${coords.lat},${coords.long}`
        : null;
      return { type: MessageType.LOCATION, text, mediaUrl: null };
    }

    return { type, text: null, mediaUrl };
  }

  /**
   * Verify Facebook webhook signature using HMAC-SHA256.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  private verifySignature(body: any, signature: string): boolean {
    const appSecret = this.configService.get<string>('FB_APP_SECRET');
    if (!appSecret || !signature) {
      this.logger.warn('[FB Webhook] Missing app secret or signature');
      return false;
    }

    const expectedSig =
      'sha256=' +
      createHmac('sha256', appSecret)
        .update(JSON.stringify(body))
        .digest('hex');

    // Timing-safe comparison
    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSig),
      );
    } catch {
      // Buffers have different lengths — signature mismatch
      return false;
    }
  }
}
