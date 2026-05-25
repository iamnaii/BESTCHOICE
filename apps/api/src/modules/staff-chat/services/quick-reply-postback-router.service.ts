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
 */
@Injectable()
export class QuickReplyPostbackRouterService {
  private readonly logger = new Logger(QuickReplyPostbackRouterService.name);

  constructor(private sender: CannedResponseSenderService) {}

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
