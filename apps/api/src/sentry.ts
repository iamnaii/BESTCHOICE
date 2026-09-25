import * as Sentry from '@sentry/nestjs';
import { redactDynamicSamplingContext, scrubShareTokensDeep, shallowScrubShareTokens } from './utils/redact-share-token.util';

const dsn = process.env.SENTRY_DSN;

/**
 * fix round 3 finding 1(a): a plain string match is not enough to decide
 * "was this a GFIN public share-link route" AFTER `scrubShareTokensDeep` has
 * already replaced the raw token with `[redacted]` (or before it ran, if the
 * route was still carrying the unresolved `GET /api/g/<token>` transaction
 * name) — so this checks for the share-route `/g/` segment in ANY of its
 * three possible shapes: a live 43-char token, the already-scrubbed
 * `[redacted]` marker, or Express's resolved route-parameter form `:token`.
 * Case-insensitive to match Express's own case-insensitive routing.
 */
const SHARE_ROUTE_SEGMENT = /\/g\/(?:[A-Za-z0-9_-]{43}|\[redacted\]|:token)(?=\/|$|\?)/i;

function isShareRouteValue(value: unknown): boolean {
  return typeof value === 'string' && SHARE_ROUTE_SEGMENT.test(value);
}

/**
 * fix round 3 finding 1(a): checks every field the re-reviewer's probe found
 * carrying the GFIN share route/token on a REAL transaction event —
 * `event.transaction`, `event.request.url`, and the OpenTelemetry root-span
 * attributes NestJS/http instrumentation stash on `contexts.trace.data`
 * (`url`, `http.url`, `http.target`). Deliberately does NOT walk `spans[]`
 * here — dropping the whole transaction on any of the fields above already
 * covers every span belonging to it, since they all share the same request.
 */
function isShareRouteTransaction(event: Sentry.Event): boolean {
  const traceData = (event.contexts?.trace as { data?: Record<string, unknown> } | undefined)?.data;
  return (
    isShareRouteValue(event.transaction) ||
    isShareRouteValue(event.request?.url) ||
    isShareRouteValue(traceData?.url) ||
    isShareRouteValue(traceData?.['http.url']) ||
    isShareRouteValue(traceData?.['http.target'])
  );
}

type SentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type BeforeSendHook = NonNullable<SentryInitOptions['beforeSend']>;
type BeforeSendTransactionHook = NonNullable<SentryInitOptions['beforeSendTransaction']>;

const SENSITIVE_REQUEST_KEYS = ['nationalId', 'password', 'phone', 'signatureImage'];

/**
 * Don't send PII (Thai national IDs, phone numbers, ...) in the captured request body.
 *
 * fix round 4 finding 1: on a REAL event `request.data` is the raw body STRING
 * (`@sentry/node-core`'s `captureRequestBody` → `normalizedRequest.data`), not an
 * object — the old `key in data` threw `TypeError` on it, so `beforeSend` threw on
 * every captured 5xx that had a body; the SDK then shipped an internal error event
 * (which skips `beforeSend`) whose message quoted the raw body, PII included
 * (probe-confirmed). A JSON body gets the listed keys redacted; any other string
 * that mentions one of them (form-encoded, or JSON truncated by the SDK's body-size
 * cap so it no longer parses) is replaced whole.
 */
function redactSensitiveRequestData(event: Sentry.Event): void {
  const request = event.request;
  if (!request || request.data == null) return;
  if (typeof request.data === 'string') {
    const body = request.data;
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = undefined; }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const hits = SENSITIVE_REQUEST_KEYS.filter((key) => key in obj);
      for (const key of hits) obj[key] = '[REDACTED]';
      if (hits.length) request.data = JSON.stringify(obj);
    } else if (SENSITIVE_REQUEST_KEYS.some((key) => body.includes(key))) {
      request.data = '[REDACTED]';
    }
    return;
  }
  if (typeof request.data === 'object') {
    const data = request.data as Record<string, unknown>;
    for (const key of SENSITIVE_REQUEST_KEYS) if (key in data) data[key] = '[REDACTED]';
  }
}

/**
 * fix round 4 finding 1 (CRITICAL): both hooks must fail CLOSED and never throw.
 * A throwing hook makes the SDK drop the event and capture an internal error
 * event in its place — and the SDK never runs `beforeSend` on internal events
 * (`@sentry/core` client.js `isInternalException`), so that replacement ships
 * unscrubbed (round 3's deep scrub threw on every real transaction; the probe
 * saw `transaction: "POST /api/g/<raw token>/reply"` go out that way).
 */
const beforeSend: BeforeSendHook = (event) => {
  try {
    redactSensitiveRequestData(event);
  } catch {
    try { if (event.request) event.request.data = '[REDACTED]'; } catch { /* nothing more we can do */ }
  }
  try {
    // fix round 5 finding 1: the DSC is sent as the envelope header `trace` — the deep
    // walk skips `sdkProcessingMetadata`, so its `transaction` is redacted here
    redactDynamicSamplingContext(event);
    return scrubShareTokensDeep(event);
  } catch {
    // keep the error visible — a shallow scrub of the fields the token is known to reach
    // (the fallback redacts the DSC too)
    return shallowScrubShareTokens(event);
  }
};

/**
 * fix round 2/3 finding 1: `tracesSampleRate` samples ~20% of routine
 * `/api/g/<token>` requests as APM transactions in production, and the token
 * rides along on `transaction`, `request.url`, `contexts.trace.data.*` and
 * `spans[].data.*` — share-route transactions are dropped outright (no APM value
 * for a public share-link hit), every other transaction is deep-scrubbed.
 * fix round 4 finding 1: the share-route check runs first, on the raw event;
 * any throw → `null` (fail closed — never let the SDK turn this into an
 * unscrubbed internal error event).
 * fix round 5: request-body PII is redacted before the share-route decision, and
 * the DSC (envelope header `trace`) is redacted on every transaction still sent.
 */
const beforeSendTransaction: BeforeSendTransactionHook = (event) => {
  try {
    // fix round 5 (Important 2): sampled transactions carry the captured request body
    // too (`POST /api/customers` shipped phone + nationalId) — same redaction as errors
    redactSensitiveRequestData(event);
    if (isShareRouteTransaction(event)) return null;
    redactDynamicSamplingContext(event); // fix round 5 finding 1 — defensive, envelope header `trace`
    return scrubShareTokensDeep(event);
  } catch {
    return null;
  }
};

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    // Never let PII or the GFIN public share-link token (embedded in the URL path,
    // `/api/g/<token>/...`) reach Sentry in ANY field an integration might put it in.
    beforeSend,
    beforeSendTransaction,
    // fix round 5 (Important 1): the SDK attaches `sentry-trace` + `baggage` to every
    // OUTGOING HTTP request by default, and `baggage` carries
    // `sentry-transaction=GET%20%2Fapi%2Fg%2F<raw token>` while serving a share-route
    // request — so the token reached the storage backend (`getStream`) and LINE. This
    // API calls no Sentry-instrumented downstream service, so propagate to none.
    // Continuing an INBOUND trace (the web app's `sentry-trace`) is unaffected.
    tracePropagationTargets: [],
  });
}
