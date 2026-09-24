/**
 * GFIN share-link routes (`finance-share-public.controller.ts`) embed a 256-bit
 * bearer token directly in the URL path (`/api/g/<43-char-token>/...`) — the
 * token IS the credential, so it must never reach a log line or Sentry event
 * verbatim, in ANY of the places a URL can end up on an event:
 *   - `SentryExceptionFilter`'s own `extra.url` / logged line (fix round 1)
 *   - `@sentry/nestjs`'s OWN `requestDataIntegration`, which independently
 *     copies the raw request URL onto `event.request.url` on every captured
 *     event regardless of what any filter does with `extra` (fix round 2
 *     finding 1 — `sentry.ts`'s `beforeSend`/`beforeSendTransaction`)
 *   - breadcrumbs that carry a `data.url` (http breadcrumbs, etc.)
 *   - APM transaction events (`tracesSampleRate` samples ~20% of routine
 *     requests in production) — both `event.request.url` and
 *     `event.transaction` (the route name) can carry the raw token
 *
 * Single source of truth so every one of those call sites redacts the same
 * pattern the same way.
 */
const SHARE_TOKEN_URL_PATTERN = /\/g\/[A-Za-z0-9_-]{43}(?=\/|$|\?)/g;

export function redactShareToken(url: string): string {
  if (typeof url !== 'string') return url;
  return url.replace(SHARE_TOKEN_URL_PATTERN, '/g/[redacted]');
}
