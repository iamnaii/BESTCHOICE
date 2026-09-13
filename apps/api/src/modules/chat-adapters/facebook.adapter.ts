import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import {
  IChannelAdapter,
  OutboundMessage,
  OutboundQuickReply,
  SendResult,
  UserProfile,
} from '../chat-engine/interfaces/channel-adapter.interface';

/** อ่านรหัสความผิดพลาดจาก body ของ Graph API (บางกรณีไม่ใช่ JSON) */
function parseFbError(errBody: string): { code?: number; subcode?: number; message?: string } {
  try {
    const parsed = JSON.parse(errBody);
    return {
      code: parsed?.error?.code,
      subcode: parsed?.error?.error_subcode,
      message: parsed?.error?.message,
    };
  } catch {
    const m = /\(#(\d+)\)/.exec(errBody);
    return { code: m ? Number(m[1]) : undefined };
  }
}

/**
 * "ส่งนอกหน้าต่าง 24 ชม." ของ Messenger
 * Graph ตอบ code 10 subcode 2018278 — เช็คข้อความสำรองไว้เผื่อ Meta เปลี่ยนรูป
 */
export function isOutsideWindowError(errBody: string): boolean {
  const { code, subcode, message } = parseFbError(errBody);
  if (subcode === 2018278) return true;
  // ⚠️ ห้ามนับ code 10 เฉย ๆ — Graph ใช้ code 10 กับ "แอปไม่มีสิทธิ์" ด้วย
  // (เช่น token ไม่มี pages_messaging) ถ้านับรวม จะไปลองแท็กซ้ำโดยเปล่าประโยชน์
  // แล้วบอกผิดว่า "เพจยังไม่ได้รับอนุมัติ Human Agent" ทั้งที่ต้นเหตุคือสิทธิ์ของ token
  return code === 10 && /outside of allowed window/i.test(message ?? errBody);
}

/** แปลงเป็นรูป `fb:<code>[:<subcode>]` ที่ฝั่งเว็บ (`send-error.ts`) รอแปลเป็นไทย */
export function formatFbError(errBody: string): string {
  const { code, subcode } = parseFbError(errBody);
  if (code === undefined) return errBody;
  const tag = subcode === undefined ? `fb:${code}` : `fb:${code}:${subcode}`;
  return `${tag} ${errBody}`;
}

/**
 * Facebook Messenger adapter — uses FB Graph API Send API.
 *
 * API reference: https://developers.facebook.com/docs/messenger-platform/reference/send-api/
 * Endpoint: POST https://graph.facebook.com/v25.0/{PAGE_ID}/messages
 *
 * Credentials are resolved from IntegrationConfig at call time — the in-app
 * Integrations settings form (DB) with FB_* env vars as fallback — so changing
 * the Page token / Page ID in the UI takes effect WITHOUT an env change or
 * restart (previously these were cached from env in the constructor, which made
 * the form unable to drive sending):
 * - pageAccessToken (FB_PAGE_ACCESS_TOKEN) — Page access token with pages_messaging
 * - pageId          (FB_PAGE_ID)           — Facebook Page ID
 * The App Secret (FB_APP_SECRET) used for inbound webhook HMAC verification is
 * read from the same IntegrationConfig by FacebookWebhookController.
 *
 * Key constraints:
 * - messaging_type is required (RESPONSE within 24h window, UPDATE, or MESSAGE_TAG)
 * - text max 2,000 UTF-8 chars
 * - attachment max 25 MB
 * - As of April 27, 2026: message tags CONFIRMED_EVENT_UPDATE, ACCOUNT_UPDATE,
 *   POST_PURCHASE_UPDATE are deprecated
 */
@Injectable()
export class FacebookAdapter implements IChannelAdapter {
  readonly channel = ChatChannel.FACEBOOK;
  private readonly logger = new Logger(FacebookAdapter.name);

  constructor(private readonly integrationConfig: IntegrationConfigService) {}

  /**
   * Resolve Page credentials from IntegrationConfig (DB form → FB_* env fallback).
   * Read per call so the in-app settings drive sending without a restart;
   * IntegrationConfigService caches the lookup, so this stays cheap.
   */
  private async getCreds(): Promise<{ pageAccessToken?: string; pageId?: string }> {
    const cfg = await this.integrationConfig.getConfig('facebook');
    return {
      pageAccessToken: cfg.pageAccessToken || undefined,
      pageId: cfg.pageId || undefined,
    };
  }

  private messagesUrl(pageId: string): string {
    return `https://graph.facebook.com/v25.0/${pageId}/messages`;
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    const { pageAccessToken, pageId } = await this.getCreds();
    if (!pageAccessToken || !pageId) {
      return { success: false, error: 'Facebook page access token or page ID not configured' };
    }

    try {
      const fbMessage: Record<string, unknown> = {};

      // Phase 4 multi-bubble — channel-agnostic OutboundMessage fields take
      // priority over legacy templatePayload. FB supports text/image/video/
      // generic-template; STICKER, LOCATION, FLEX, JSON are unsupported and
      // are dropped gracefully with a droppedReason.
      if (message.imageUrl) {
        fbMessage.attachment = {
          type: 'image',
          payload: { url: message.imageUrl, is_reusable: true },
        };
      } else if (message.videoUrl) {
        fbMessage.attachment = {
          type: 'video',
          payload: { url: message.videoUrl, is_reusable: true },
        };
      } else if (message.flexJson) {
        // Translate simplified card JSON → FB generic template
        fbMessage.attachment = {
          type: 'template',
          payload: this.cardToFbGenericTemplate(message.flexJson),
        };
      } else if (message.text) {
        fbMessage.text = message.text;
      } else if (message.templatePayload) {
        // Legacy templatePayload path — preserved for back-compat with existing
        // callers that hand-build FB attachments.
        if (message.templatePayload.type && message.templatePayload.payload) {
          fbMessage.attachment = message.templatePayload;
        }
        if (message.templatePayload.quick_replies) {
          fbMessage.quick_replies = message.templatePayload.quick_replies;
        }
      } else if (message.sticker || message.location || message.jsonPayload) {
        const reason = message.sticker
          ? 'sticker_unsupported_on_facebook'
          : message.location
            ? 'location_unsupported_on_facebook'
            : 'raw_json_unsupported_on_facebook';
        this.logger.warn(
          `[FB] drops unsupported bubble (${reason}) for ${message.externalUserId}`,
        );
        return { success: true, droppedReason: reason };
      } else {
        return { success: false, error: 'no message content' };
      }

      // Phase 4 — attach quick replies (overrides any legacy quick_replies on
      // templatePayload that we don't already have on fbMessage).
      if (message.quickReplies && message.quickReplies.length > 0 && !fbMessage.quick_replies) {
        fbMessage.quick_replies = this.buildFbQuickReplies(message.quickReplies);
      }

      const post = async (envelope: Record<string, unknown>) => {
        const res = await fetch(this.messagesUrl(pageId), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${pageAccessToken}`,
          },
          body: JSON.stringify({
            ...envelope,
            recipient: { id: message.externalUserId },
            message: fbMessage,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const data = (await res.json()) as { message_id?: string };
          return { ok: true as const, messageId: data.message_id };
        }
        return { ok: false as const, status: res.status, errBody: await res.text() };
      };

      // ปกติใช้ RESPONSE — ตอบในหน้าต่าง 24 ชม. ของ Meta
      let attempt = await post({ messaging_type: 'RESPONSE' });

      // 🔴 ถ้าพ้น 24 ชม. เดิมจบแค่ error ⇒ แอดมินตอบลูกค้าที่เงียบข้ามวันไม่ได้เลย
      // ขณะที่แอป Facebook ของ Meta เองตอบได้ถึง 7 วันเพราะใช้หน้าต่าง human agent
      // (prod: 8,703 จาก 8,789 ห้องอยู่นอกหน้าต่างตอนนี้ — เปิดห้องเก่าพิมพ์ = error ทุกใบ)
      // ลองซ้ำครั้งเดียวด้วยแท็ก HUMAN_AGENT ซึ่งยืดเป็น 7 วัน
      // ปลอดภัยกับของเดิม: ในหน้าต่าง 24 ชม. ไม่มีอะไรเปลี่ยน และถ้าเพจยังไม่ได้รับอนุมัติ
      // ฟีเจอร์ Human Agent ก็แค่ล้มเหมือนเดิม ไม่ได้แย่ลง
      const retriedHumanAgent = !attempt.ok && isOutsideWindowError(attempt.errBody);
      if (retriedHumanAgent) {
        this.logger.warn(
          `[FB] พ้นหน้าต่าง 24 ชม. สำหรับ ${message.externalUserId} — ลองใหม่ด้วยแท็ก HUMAN_AGENT`,
        );
        attempt = await post({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
      }

      if (!attempt.ok) {
        this.logger.error(`[FB] API error ${attempt.status}: ${attempt.errBody}`);
        return {
          success: false,
          // รูป `fb:<code>[:<subcode>]` — ฝั่งเว็บ (`send-error.ts`) รอรูปนี้อยู่แล้วเพื่อแปลเป็นไทย
          // แนบตัวเต็มต่อท้ายไว้ไม่ให้ข้อมูลหาย · ถ้าลองแท็กแล้วยังไม่ผ่าน บอกให้ชัดว่าลองแล้ว
          // ไม่งั้นจะขึ้นว่า "พ้น 24 ชม." เฉย ๆ ทั้งที่ระบบพยายามทางที่สองไปแล้ว
          error: `${formatFbError(attempt.errBody)}${retriedHumanAgent ? ' (ลองแท็ก HUMAN_AGENT แล้วยังไม่ผ่าน — เพจอาจยังไม่ได้รับอนุมัติฟีเจอร์ Human Agent)' : ''}`,
        };
      }

      return { success: true, externalMessageId: attempt.messageId };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      this.logger.error(`[FB] send failed${isTimeout ? ' (timeout)' : ''}: ${errorMsg}`);
      if (isTimeout) {
        Sentry.captureException(err, {
          tags: { module: 'chat-adapter-facebook', action: 'send_message', reason: 'timeout' },
        });
      }
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Build FB Messenger quick_replies[]. FB supports up to 13 entries
   * (current API limit). URL quick replies don't exist on FB — degrade to
   * text type with the URL stuffed into the payload so a staff postback
   * handler can still route it.
   */
  private buildFbQuickReplies(qrs: OutboundQuickReply[]): Array<Record<string, unknown>> {
    return qrs.slice(0, 13).map((q) => ({
      content_type: 'text',
      title: q.label,
      payload:
        q.type === 'POSTBACK'
          ? (q.payload ?? '')
          : q.type === 'URL'
            ? (q.url ?? '')
            : (q.message ?? q.label),
    }));
  }

  /**
   * Translate a simplified card JSON (Phase 4 CARD bubble) to an FB
   * generic-template payload. Card shape:
   *   { title, subtitle?, heroImageUrl?, buttons?: [{ label, type: 'URL'|'POSTBACK', value }] }
   */
  private cardToFbGenericTemplate(card: any): Record<string, unknown> {
    const buttons = Array.isArray(card?.buttons)
      ? card.buttons.slice(0, 3).map((b: any) => {
          if (b?.type === 'URL') {
            return { type: 'web_url', title: b.label, url: b.value };
          }
          return { type: 'postback', title: b.label, payload: b.value ?? '' };
        })
      : undefined;
    return {
      template_type: 'generic',
      elements: [
        {
          title: card?.title ?? 'Card',
          subtitle: card?.subtitle ?? '',
          image_url: card?.heroImageUrl,
          ...(buttons && buttons.length > 0 ? { buttons } : {}),
        },
      ],
    };
  }

  async sendTypingIndicator(externalUserId: string): Promise<void> {
    const { pageAccessToken, pageId } = await this.getCreds();
    if (!pageAccessToken || !pageId) return;
    try {
      await fetch(this.messagesUrl(pageId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pageAccessToken}`,
        },
        body: JSON.stringify({
          recipient: { id: externalUserId },
          sender_action: 'typing_on',
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Best-effort, ignore errors
    }
  }

  async getUserProfile(externalUserId: string): Promise<UserProfile | null> {
    const { pageAccessToken } = await this.getCreds();
    if (!pageAccessToken) return null;

    // Try 1 — Messenger User Profile API (returns name + profile_pic).
    // Works only when pages_messaging is at Advanced Access tier (post App Review).
    // Currently returns 400/100/33 in dev mode; falls through silently.
    const direct = await this.fetchDirectProfile(externalUserId, pageAccessToken);
    if (direct) return direct;

    // Try 2 — Workaround via /me/conversations participants (returns name only,
    // no profile_pic). Always works while pages_messaging is granted.
    return this.fetchProfileViaConversations(externalUserId, pageAccessToken);
  }

  private async fetchDirectProfile(
    externalUserId: string,
    pageAccessToken: string,
  ): Promise<UserProfile | null> {
    try {
      // The Messenger User Profile API returns first_name/last_name (+ profile_pic),
      // NOT a `name` field — request those and join, mirroring the working OBI setup.
      // Must be called with the webhook sender.id PSID (which this is), not a
      // Conversations-API participant id (that id 404s on the user-profile node).
      const url =
        `https://graph.facebook.com/v25.0/${encodeURIComponent(externalUserId)}` +
        `?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(pageAccessToken)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        first_name?: string;
        last_name?: string;
        profile_pic?: string;
      };
      const displayName = `${json.first_name ?? ''} ${json.last_name ?? ''}`.trim();
      if (!displayName) return null;
      return { displayName, avatarUrl: json.profile_pic };
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      if (isTimeout) {
        this.logger.warn(`[FB] fetchDirectProfile timeout for PSID ${externalUserId}`);
        Sentry.captureException(err, {
          tags: {
            module: 'chat-adapter-facebook',
            action: 'fetch_direct_profile',
            reason: 'timeout',
          },
        });
      }
      return null;
    }
  }

  private async fetchProfileViaConversations(
    externalUserId: string,
    pageAccessToken: string,
  ): Promise<UserProfile | null> {
    try {
      const url =
        `https://graph.facebook.com/v25.0/me/conversations?user_id=${encodeURIComponent(externalUserId)}` +
        `&fields=participants&access_token=${encodeURIComponent(pageAccessToken)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: Array<{ participants?: { data?: Array<{ id: string; name?: string }> } }>;
      };
      const conv = json.data?.[0];
      const user = conv?.participants?.data?.find((p) => p.id === externalUserId);
      if (!user?.name) return null;
      return { displayName: user.name };
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      if (isTimeout) {
        this.logger.warn(
          `[FB] fetchProfileViaConversations timeout for PSID ${externalUserId}`,
        );
        Sentry.captureException(err, {
          tags: {
            module: 'chat-adapter-facebook',
            action: 'fetch_profile_via_conversations',
            reason: 'timeout',
          },
        });
      }
      return null;
    }
  }
}
