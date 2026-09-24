import * as Sentry from '@sentry/nestjs';
import { scrubShareTokensDeep } from './utils/redact-share-token.util';

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

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    // Don't send PII (Thai national IDs, phone numbers) to Sentry, and never let the
    // GFIN public share-link token (embedded in the URL path, `/api/g/<token>/...`)
    // reach Sentry in ANY field an integration might put it in.
    beforeSend(event) {
      if (event.request?.data) {
        const data = event.request.data as Record<string, unknown>;
        const sensitiveKeys = ['nationalId', 'password', 'phone', 'signatureImage'];
        for (const key of sensitiveKeys) {
          if (key in data) data[key] = '[REDACTED]';
        }
      }
      // fix round 3 finding 1(a): field-by-field scrubbing (request.url / extra.url /
      // breadcrumb data.url only) missed event.transaction and the OpenTelemetry span
      // attributes an error event can also carry — deep-scrub the WHOLE event instead.
      return scrubShareTokensDeep(event);
    },
    // fix round 2 finding 1(a) + fix round 3 finding 1(a)/(b): `tracesSampleRate`
    // samples ~20% of routine `/api/g/<token>` requests as APM transactions in
    // production. A field-by-field scrub still leaked the token via
    // `contexts.trace.data.url`/`.data["http.url"]`/`.data["http.target"]` (root span
    // attributes `@sentry/node-core`'s `httpServerSpansIntegration` sets, copied over
    // by `@sentry/opentelemetry`) and `spans[].data["http.url"|"url.full"]` (the
    // default `nestIntegration`) — deep-scrub first, then drop the transaction
    // entirely for share routes (there's no APM value in tracing a public share-link
    // hit, and dropping it removes this whole leak class rather than chasing fields).
    beforeSendTransaction(event) {
      const scrubbed = scrubShareTokensDeep(event);
      if (isShareRouteTransaction(scrubbed)) return null;
      return scrubbed;
    },
  });
}
