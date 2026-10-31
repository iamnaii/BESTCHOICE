import { ServiceUnavailableException } from '@nestjs/common';
import type { CommentReceiveNotReady } from './facebook-comment-capability';

/**
 * Task 35 (owner 2026-10-31, option 4) — the ONE place that decides what a failed comment ingest
 * does to the webhook request that carried it.
 *
 * The webhook still persists comment changes before it dispatches Messenger events (a 5xx must
 * not replay a postback side effect — Messenger redelivery is not deduplicated for postbacks and
 * system notes). What changes is which failures may hold those Messenger events:
 *
 * - PERMANENT — redelivering the same request cannot fix it (configuration proven incomplete, Meta
 *   answered that the token/permission/feed subscription is not ready, the event itself is
 *   malformed or contradicts stored data). Thrown as `FacebookCommentIngestSkipped`; the webhook
 *   reports it (ids + reason code only) and keeps processing Messenger, answering 200. The skipped
 *   comment changes are not redelivered.
 * - TRANSIENT — everything else (database, Graph outage/5xx/rate limit/timeout, unknown). Meta must
 *   redeliver, so the webhook answers non-2xx and Messenger in that request waits as before.
 *
 * Anything not explicitly thrown as `FacebookCommentIngestSkipped` is TRANSIENT — an unsure cause
 * must keep its redelivery.
 */
export type CommentIngestSkipReason =
  /** Integration Hub configuration cannot serve this Page (credentials, Page binding, transport). */
  | 'COMMENT_CONFIG_INCOMPLETE'
  /** Meta answered: token invalid/expired, permission missing, or app not subscribed to feed. */
  | 'COMMENT_META_NOT_READY'
  /** A comment change without comment_id / post_id / a known verb. */
  | 'COMMENT_EVENT_MALFORMED'
  /** The change's post differs from the post its stored thread belongs to. */
  | 'COMMENT_POST_MISMATCH';

export class FacebookCommentIngestSkipped extends Error {
  constructor(
    readonly reasonCode: CommentIngestSkipReason,
    /** Thai, user-facing wording kept from the original exception (no customer data). */
    message: string,
    /** Comment changes of the entry that were not persisted because of this. */
    readonly skippedChanges = 1,
  ) {
    super(message);
    this.name = 'FacebookCommentIngestSkipped';
  }
}

export type CommentIngestFailure =
  | { retry: true }
  | { retry: false; reasonCode: CommentIngestSkipReason; skippedChanges: number };

export function classifyCommentIngestFailure(error: unknown): CommentIngestFailure {
  return error instanceof FacebookCommentIngestSkipped
    ? { retry: false, reasonCode: error.reasonCode, skippedChanges: error.skippedChanges }
    : { retry: true };
}

const NOT_READY_REASON: Record<CommentReceiveNotReady, CommentIngestSkipReason> = {
  CONFIG: 'COMMENT_CONFIG_INCOMPLETE',
  META_PERMISSION: 'COMMENT_META_NOT_READY',
};

/** The error for a capability that cannot receive: permanent only with proof, else the old 503. */
export function receiveNotReadyFailure(
  capabilities: { reason?: string | null; notReady?: CommentReceiveNotReady },
  changes: number,
): Error {
  const message = capabilities.reason || 'ยังไม่ยืนยันสิทธิ์การเชื่อมต่อ';
  return capabilities.notReady
    ? new FacebookCommentIngestSkipped(NOT_READY_REASON[capabilities.notReady], message, changes)
    : new ServiceUnavailableException(message);
}
