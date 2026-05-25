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
  InternalServerErrorException,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { InboundMessage } from '../chat-engine/interfaces/channel-adapter.interface';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ChatChannel, MessageRole, MessageType } from '@prisma/client';
import { RawBodyRequest } from '../../common/types/raw-body-request';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';
import { QuickReplyPostbackRouterService } from '../staff-chat/services/quick-reply-postback-router.service';
import { PrismaService } from '../../prisma/prisma.service';

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
    private anomaly: WebhookAnomalyService,
    private postbackRouter: QuickReplyPostbackRouterService,
    private prisma: PrismaService,
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
    @Res() res: Response,
  ): void {
    const verifyToken = this.configService.get<string>('FB_VERIFY_TOKEN');
    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('[FB Webhook] Verification succeeded');
      res.status(200).send(challenge);
      return;
    }
    this.logger.warn(`[FB Webhook] Verification failed — mode=${mode}`);
    res.status(400).send('Verification failed');
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
    @Req() req: Request,
    @Body() body: any,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<string> {
    const rawBody = (req as unknown as RawBodyRequest).rawBody;

    // 0. SLO alert — rawBody missing means the json() verify callback in
    // main.ts never fired for this request. That's a middleware ordering /
    // body parser regression and every FB event would silently fail HMAC
    // verification. Escalate to Sentry + force Facebook to retry (500)
    // rather than silently 200-ing a broken request.
    if (!rawBody) {
      this.logger.error(
        '[FB Webhook] rawBody missing — json() verify callback did not capture bytes. Middleware ordering bug?',
      );
      Sentry.captureMessage('Facebook webhook rawBody capture failed', { level: 'error' });
      void this.anomaly.record({
        provider: 'facebook',
        reason: 'other',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        meta: { note: 'missing_raw_body' },
      });
      throw new InternalServerErrorException('Webhook body capture failed');
    }

    // 1. Verify HMAC-SHA256 signature against raw request bytes
    if (!this.verifySignature(rawBody, signature)) {
      this.logger.warn('[FB Webhook] Invalid signature — rejecting payload');
      void this.anomaly.record({
        provider: 'facebook',
        reason: signature ? 'invalid_signature' : 'missing_signature',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
      });
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
   * Supports: text messages, attachments (image/audio/video/file), postbacks,
   * and echoes (admin replied via Meta Business Suite / Page Inbox).
   * Ignores: read receipts, delivery confirmations.
   */
  private async processMessagingEvent(event: any): Promise<void> {
    const senderId: string | undefined = event.sender?.id;
    const recipientId: string | undefined = event.recipient?.id;
    const message = event.message;
    const postback = event.postback;

    if (!senderId) return;

    // Echo: admin replied via Meta Business Suite / FB Page Inbox / FB Page app.
    // sender.id = our PAGE_ID, recipient.id = customer PSID, message.is_echo = true.
    // Record as STAFF so the reply shows up in /chat alongside our own sends.
    if (message?.is_echo === true) {
      await this.processEchoEvent(event, recipientId);
      return;
    }

    // Handle postback events (persistent menu clicks, button taps)
    if (postback && !message) {
      const payload: string = postback.payload ?? postback.title ?? '';

      // Phase 5 — Quick Reply postback router. If the payload matches a
      // known canned-response format (e.g. `TEMPLATE:<id>`), dispatch it
      // here and DON'T pollute the message log with a fake TEXT entry.
      // Falls through to the routeInbound() path below for any unrecognised
      // payload, preserving the original behavior for menu clicks etc.
      try {
        const room = await this.prisma.chatRoom.findFirst({
          where: {
            externalUserId: senderId,
            channel: ChatChannel.FACEBOOK,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (room) {
          const routeResult = await this.postbackRouter.route(room.id, payload);
          if (routeResult.handled) {
            this.logger.log(
              `[FB postback router] PSID ${senderId} payload "${payload}" → ${routeResult.action ?? 'unknown'}${routeResult.error ? ` (error: ${routeResult.error})` : ''}`,
            );
            return;
          }
        }
      } catch (err) {
        this.logger.warn(
          `[FB postback router] failed: ${err instanceof Error ? err.message : err}`,
        );
        // fall through to legacy routeInbound path
      }

      const referral = postback.referral ?? event.referral;
      const attribution = referral
        ? {
            utmSource: 'facebook',
            utmCampaign: referral.ad_id ?? referral.ref ?? undefined,
            utmContent: referral.ref ?? undefined,
            referrerUrl: referral.source ?? undefined,
          }
        : undefined;

      const inbound: InboundMessage = {
        externalMessageId: `postback_${Date.now()}_${senderId}`,
        externalUserId: senderId,
        channel: ChatChannel.FACEBOOK,
        type: MessageType.TEXT,
        text: payload,
        rawPayload: event,
        timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
        attribution,
      };

      this.logger.log(
        `[FB Webhook] Postback from PSID ${senderId}: "${postback.payload}"`,
      );

      await this.messageRouter.routeInbound(inbound);
      return;
    }

    if (!message) return;

    const { type, text, mediaUrl } = this.parseMessage(message);

    // Extract Facebook referral / ad attribution data
    const referral = event.referral ?? event.postback?.referral;
    const attribution = referral
      ? {
          utmSource: 'facebook',
          utmCampaign: referral.ad_id ?? referral.ref ?? undefined,
          utmContent: referral.ref ?? undefined,
          referrerUrl: referral.source ?? undefined,
        }
      : undefined;

    const inbound: InboundMessage = {
      externalMessageId: message.mid,
      externalUserId: senderId,
      channel: ChatChannel.FACEBOOK,
      type,
      text: text ?? undefined,
      mediaUrl: mediaUrl ?? undefined,
      rawPayload: event,
      timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
      attribution,
    };

    this.logger.log(
      `[FB Webhook] Inbound ${type} from PSID ${senderId} (mid: ${message.mid})${attribution ? ' [with attribution]' : ''}`,
    );

    await this.messageRouter.routeInbound(inbound);
  }

  /**
   * Persist a Facebook `message_echoes` event as a STAFF message so admin
   * replies sent outside our /chat UI (Meta Business Suite, Page Inbox, FB
   * Page mobile app) still appear in the unified inbox.
   *
   * Dedup strategy (two layers):
   * 1. Skip echoes whose `message.app_id` matches our own FACEBOOK_APP_ID — those
   *    were sent by `sendStaffMessage` and are already in the DB.
   * 2. Fallback: rely on the UNIQUE constraint on `ChatMessage.externalMessageId`
   *    (FB `mid`). `mirrorOutbound` swallows P2002 conflicts so retried webhook
   *    deliveries don't double-record.
   *
   * Identifying *which* admin clicked Send is not possible — Facebook removed
   * page-admin enumeration in Graph API v15+ and echoes do not carry the admin's
   * user id. Source of the reply (Meta Business Suite vs Page Inbox vs an app)
   * is only knowable via `message.app_id`, which we log but don't persist.
   */
  private async processEchoEvent(event: any, recipientId: string | undefined): Promise<void> {
    const message = event.message;

    if (!recipientId) {
      this.logger.warn('[FB Webhook] Echo event missing recipient.id — cannot map to customer room');
      return;
    }

    const ownAppId = this.configService.get<string>('FACEBOOK_APP_ID');
    const echoAppId = message.app_id != null ? String(message.app_id) : undefined;

    if (ownAppId && echoAppId && echoAppId === ownAppId) {
      // Our own sendStaffMessage already persisted this message — skip.
      return;
    }

    if (!ownAppId) {
      this.logger.warn(
        '[FB Webhook] FACEBOOK_APP_ID not set — cannot distinguish own sends from external echoes; relying on externalMessageId UNIQUE for dedup',
      );
    }

    const { type, text, mediaUrl } = this.parseMessage(message);

    this.logger.log(
      `[FB Webhook] Echo ${type} → PSID ${recipientId} (mid: ${message.mid}, app_id: ${echoAppId ?? 'none'})`,
    );

    await this.messageRouter.mirrorOutbound({
      externalUserId: recipientId,
      channel: ChatChannel.FACEBOOK,
      role: MessageRole.STAFF,
      type,
      text: text ?? undefined,
      mediaUrl: mediaUrl ?? undefined,
      externalMessageId: message.mid,
    });
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
   * Data Deletion Request — Facebook sends POST when user requests data deletion.
   *
   * Facebook requires this endpoint to comply with GDPR/PDPA.
   * Must return a JSON response with:
   *   { url: "<status_check_url>", confirmation_code: "<unique_code>" }
   *
   * Docs: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
   */
  @Post('data-deletion')
  @SkipCsrf()
  @HttpCode(200)
  async handleDataDeletion(
    @Body() body: { signed_request?: string },
  ): Promise<{ url: string; confirmation_code: string }> {
    const appSecret = this.configService.get<string>('FB_APP_SECRET');
    if (!appSecret || !body.signed_request) {
      this.logger.warn('[FB Data Deletion] Missing app secret or signed_request');
      throw new BadRequestException('Invalid request');
    }

    // Parse Facebook signed_request (base64url encoded: sig.payload)
    const [sigB64, payloadB64] = body.signed_request.split('.');
    if (!sigB64 || !payloadB64) {
      throw new BadRequestException('Malformed signed_request');
    }

    // Verify signature
    const expectedSig = createHmac('sha256', appSecret)
      .update(payloadB64)
      .digest('base64url');

    if (!this.timingSafeCompare(sigB64, expectedSig)) {
      this.logger.warn('[FB Data Deletion] Signature verification failed');
      throw new BadRequestException('Invalid signature');
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    const userId: string = payload.user_id;

    const confirmationCode = `fb_del_${userId}_${Date.now()}`;

    this.logger.log(
      `[FB Data Deletion] Request received for Facebook user ${userId} — code: ${confirmationCode}`,
    );

    // TODO: If we store Facebook user data (PSID→customer mapping),
    // queue a deletion job here. For now, we log and acknowledge.
    // Our chat system doesn't persist FB user profiles beyond the chat session.

    const baseUrl = this.configService.get<string>('FRONTEND_URL') || 'https://bestchoicephone.app';

    return {
      url: `${baseUrl}/privacy?deletion=${confirmationCode}`,
      confirmation_code: confirmationCode,
    };
  }

  /**
   * Deauthorize Callback — Facebook sends POST when user removes the app.
   */
  @Post('deauthorize')
  @SkipCsrf()
  @HttpCode(200)
  async handleDeauthorize(
    @Body() body: { signed_request?: string },
  ): Promise<{ success: boolean }> {
    if (body.signed_request) {
      const [sigB64, payloadB64] = body.signed_request.split('.');
      if (sigB64 && payloadB64) {
        const appSecret = this.configService.get<string>('FB_APP_SECRET');
        if (appSecret) {
          const expectedSig = createHmac('sha256', appSecret)
            .update(payloadB64)
            .digest('base64url');
          if (!this.timingSafeCompare(sigB64, expectedSig)) {
            this.logger.warn('[FB Deauthorize] Invalid signed_request signature');
          }
        }
      }
    }
    this.logger.log('[FB Deauthorize] User revoked app authorization');
    // Acknowledge — no user data to delete beyond chat messages
    return { success: true };
  }

  /**
   * Verify Facebook webhook signature using HMAC-SHA256 against raw request bytes.
   * Uses timing-safe comparison to prevent timing attacks.
   *
   * Facebook signs the exact raw body bytes — we MUST use rawBody (captured by
   * main.ts json() verify callback), not JSON.stringify(parsed), because
   * re-serialization can differ in whitespace/ordering and break verification.
   */
  private verifySignature(rawBody: Buffer | undefined, signature: string): boolean {
    const appSecret = this.configService.get<string>('FB_APP_SECRET');
    if (!appSecret || !signature) {
      this.logger.warn('[FB Webhook] Missing app secret or signature');
      return false;
    }
    if (!rawBody) {
      this.logger.warn('[FB Webhook] Missing raw body — cannot verify signature');
      return false;
    }

    const expectedSig =
      'sha256=' +
      createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex');

    return this.timingSafeCompare(signature, expectedSig);
  }

  /**
   * Timing-safe string comparison to prevent timing attacks.
   * Returns false on length mismatch (different lengths also indicate mismatch).
   */
  private timingSafeCompare(a: string, b: string): boolean {
    try {
      return timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false; // length mismatch
    }
  }
}
