import { Injectable, Logger } from '@nestjs/common';
import { CannedResponseSenderService } from './canned-response-sender.service';

export interface QuickReplyRouteResult {
  handled: boolean;
  action?: 'send-template' | 'unknown';
  templateId?: string;
  error?: string;
}

/**
 * QuickReplyPostbackRouterService — Phase 5 backend.
 *
 * Parses postback payload strings emitted by Quick Reply buttons and
 * dispatches to the matching action. v1 supports a single format:
 *
 *   `TEMPLATE:<canned-response-id>` → re-send that canned response into
 *   the same room (as the system bot user).
 *
 * When the payload does NOT match any known format, returns
 * `{ handled: false }` so the caller can fall through to its existing
 * routing pipeline (intent matcher / AI). This keeps the router additive
 * and non-breaking — channels that already have hardcoded postback
 * actions (LINE: check_balance, check_installments, pay) continue to
 * work unchanged.
 *
 * ## Channel coverage (W5)
 *
 * Postback routing is wired ONLY for channels that emit rich
 * server-side postback events:
 *   - LINE_FINANCE (chatbot-finance.service.ts handlePostback)
 *   - LINE_SHOP    (sales-bot postback handler)
 *   - FACEBOOK     (facebook-webhook.controller.ts processMessagingEvent)
 *
 * TIKTOK and WEB channels DO NOT currently expose webhook-level postback
 * events. Quick Reply bubbles still render visually on those channels
 * (via the `channels[]` filter on `Bubble.channels` / `QuickReply` rows),
 * but when a customer taps a Quick Reply the tap is delivered as a plain
 * TEXT message rather than a typed postback — so it falls through the
 * normal AI / intent-matcher pipeline like any other inbound text. This
 * is a graceful degradation, not a bug.
 *
 * If TikTok or our web widget ever ship server-side postback events,
 * wire the same `await postbackRouter.route(roomId, payload)` call into
 * the new webhook handler before falling through to `routeInbound()`
 * (see facebook-webhook.controller.ts for the canonical pattern).
 *
 * ## Loop guard (W7)
 *
 * A canned-response template A whose Quick Reply payload =
 * `TEMPLATE:<B>`, and template B whose Quick Reply payload =
 * `TEMPLATE:<A>`, would let a customer create a tight reply loop by
 * tapping repeatedly. To bound the blast radius, `route()` keeps an
 * in-memory sliding window of recent postback dispatches per room. If a
 * single room exceeds `MAX_PER_WINDOW` postback-triggered sends in
 * `WINDOW_MS`, the next attempt is skipped and the router logs a
 * warning. Counters are per-process and reset on app restart — fine for
 * a defensive guard.
 */
@Injectable()
export class QuickReplyPostbackRouterService {
  private readonly logger = new Logger(QuickReplyPostbackRouterService.name);

  /**
   * W7 — Per-room sliding window of recent postback-triggered dispatch
   * timestamps (ms since epoch). Caps blast radius for QR loops where
   * template A's button payload points to B and B's button points back to A.
   * Entries are pruned lazily on each call; map grows by one key per room
   * that has ever sent a postback (bounded by active customer count).
   * Reset on app restart is acceptable for a defensive rate limit.
   */
  private readonly recentSends = new Map<string, number[]>();
  private readonly WINDOW_MS = 10_000;
  private readonly MAX_PER_WINDOW = 5;

  constructor(private sender: CannedResponseSenderService) {}

  /**
   * Returns true if `roomId` has dispatched MAX_PER_WINDOW or more
   * postback-triggered sends in the last WINDOW_MS. Side effect: prunes
   * old timestamps and appends the current one when not rate-limited.
   */
  private isRateLimited(roomId: string): boolean {
    const now = Date.now();
    const recent = (this.recentSends.get(roomId) ?? []).filter(
      (t) => now - t < this.WINDOW_MS,
    );
    if (recent.length >= this.MAX_PER_WINDOW) {
      // Pruned-but-still-over-limit — write back so we don't keep
      // discarding the same expired entries on each tap.
      this.recentSends.set(roomId, recent);
      return true;
    }
    recent.push(now);
    this.recentSends.set(roomId, recent);
    return false;
  }

  /**
   * Try to handle a postback payload as a canned-response Quick Reply action.
   *
   * @returns `{ handled: false }` when the payload doesn't match any known
   * format — caller should fall back to its existing routing.
   * `{ handled: true, ... }` otherwise (success or known-failure).
   */
  async route(roomId: string, payload: string): Promise<QuickReplyRouteResult> {
    if (!payload || typeof payload !== 'string') {
      return { handled: false };
    }

    // Format: TEMPLATE:<canned-response-id>
    if (payload.startsWith('TEMPLATE:')) {
      const templateId = payload.slice('TEMPLATE:'.length).trim();
      if (!templateId) {
        this.logger.warn(`postback TEMPLATE payload missing id (room ${roomId})`);
        return {
          handled: true,
          action: 'unknown',
          error: 'TEMPLATE: payload missing id',
        };
      }
      // W7: cap rapid-fire postback dispatches per room — protects against
      // accidental or malicious A→B→A QR loops. Check BEFORE dispatch so a
      // looping customer can't drain the sender pipeline.
      if (this.isRateLimited(roomId)) {
        this.logger.warn(
          `postback rate-limited for room ${roomId}: >${this.MAX_PER_WINDOW} sends in ${this.WINDOW_MS}ms — possible Quick Reply loop`,
        );
        return {
          handled: true,
          action: 'send-template',
          templateId,
          error: 'rate-limited (possible loop)',
        };
      }
      try {
        const result = await this.sender.send(roomId, templateId, null);
        this.logger.log(
          `postback TEMPLATE → sent ${result.sent} bubbles (dropped ${result.dropped}) to room ${roomId} (template ${templateId})`,
        );
        return { handled: true, action: 'send-template', templateId };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`postback TEMPLATE send failed: ${errorMsg}`);
        return {
          handled: true,
          action: 'send-template',
          templateId,
          error: errorMsg,
        };
      }
    }

    return { handled: false };
  }
}
