import { createHash } from 'crypto';

/**
 * Task 37 (owner #27, 2026-11-01) — one dedupe key per Messenger webhook event.
 *
 * Meta resends a notification when we answer slowly or non-2xx and asks receivers to
 * deduplicate. A redelivery is the same JSON again, so a key may only use what the event
 * itself carries — never the time we received it (`Date.now()`):
 *
 * | event | identity |
 * |---|---|
 * | customer message | `message.mid` (the same id `chat_messages.external_message_id` UNIQUE uses) |
 * | echo from another app (Meta Business Suite / Page inbox) | `message.mid` |
 * | postback (Get Started, menu, `TEMPLATE:` buttons) | sender + page + `timestamp` + `postback.mid` + `payload` |
 * | referral with no message (m.me link / ad, returning customer) | sender + page + `timestamp` + ref/source/type/ad_id |
 *
 * `timestamp` is the event time in ms that Meta tells receivers to order events by — the
 * same value on a redelivery (the journey `PRODUCT_LINK_CLICK` dedupe already relies on it).
 * A postback keys on both `timestamp` and `postback.mid`: Meta's reference only says "the ID
 * for the message", so two taps of one button stay two events even if that id were the
 * button's message.
 *
 * Keys are `fb:<kind>:<sha256>` — no PSID, payload or mid in clear in `processed_webhook_events`.
 * `null` = nothing to gate (read/delivery receipts, our own echoes, no sender) or nothing
 * stable to key on (then the event runs as before).
 */
export type MessengerEventKind = 'message' | 'echo' | 'postback' | 'referral';

export interface MessengerEventDedupe {
  kind: MessengerEventKind;
  key: string;
}

type Part = string | null;

/** The fields of a Meta `messaging[]` item this module reads — everything else is ignored. */
interface MessagingEvent {
  sender?: { id?: unknown };
  recipient?: { id?: unknown };
  timestamp?: unknown;
  message?: { is_echo?: unknown; app_id?: unknown; mid?: unknown };
  postback?: { mid?: unknown; payload?: unknown };
  referral?: { ref?: unknown; source?: unknown; type?: unknown; ad_id?: unknown };
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function keyOf(kind: MessengerEventKind, parts: Part[]): MessengerEventDedupe {
  const digest = createHash('sha256')
    .update(JSON.stringify([kind, ...parts]))
    .digest('hex');
  return { kind, key: `fb:${kind}:${digest}` };
}

/**
 * @param ownAppId `FACEBOOK_APP_ID` — echoes of our own sends are skipped by the controller
 *   before any side effect, so they get no key (no row per bot/staff reply).
 */
export function messengerEventDedupe(
  event: unknown,
  ownAppId?: string,
): MessengerEventDedupe | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as MessagingEvent;
  const sender = text(e.sender?.id);
  if (!sender) return null;
  const recipient = text(e.recipient?.id);
  const timestamp = text(e.timestamp);
  const message = e.message;
  const postback = e.postback;

  if (message?.is_echo === true) {
    const appId = message.app_id != null ? String(message.app_id) : undefined;
    if (!recipient || (ownAppId && appId === ownAppId)) return null;
    const mid = text(message.mid);
    return mid ? keyOf('echo', [mid]) : null;
  }

  if (postback && !message) {
    const mid = text(postback.mid);
    if (!mid && !timestamp) return null;
    return keyOf('postback', [sender, recipient, timestamp, mid, text(postback.payload)]);
  }

  if (e.referral && !message && !postback) {
    if (!timestamp) return null;
    const r = e.referral;
    return keyOf('referral', [
      sender,
      recipient,
      timestamp,
      text(r.ref),
      text(r.source),
      text(r.type),
      text(r.ad_id),
    ]);
  }

  if (message) {
    const mid = text(message.mid);
    return mid ? keyOf('message', [mid]) : null;
  }

  return null;
}

/**
 * `externalMessageId` of a postback that becomes a customer bubble (`routeInbound`). Built from
 * the event so a redelivery that slips past the gate (dedupe store unavailable → fail open) still
 * hits the `chat_messages.external_message_id` UNIQUE before the bot turn. Was
 * `postback_${Date.now()}_${sender}` — new on every delivery, and equal for two postbacks of one
 * sender handled in the same millisecond.
 */
export function postbackExternalMessageId(event: MessagingEvent): string {
  const sender = String(event.sender?.id ?? '');
  const timestamp = text(event.timestamp);
  if (timestamp) return `postback_${timestamp}_${sender}`;
  const mid = text(event.postback?.mid);
  if (mid) return `postback_${mid}`;
  return `postback_${Date.now()}_${sender}`;
}
