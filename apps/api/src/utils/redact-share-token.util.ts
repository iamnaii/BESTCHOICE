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
 *
 * fix round 3 finding 1(c): case-insensitive — Express routing is
 * case-insensitive by default, so `/api/G/<token>` is served identically to
 * `/api/g/<token>` and must be scrubbed the same way (moot for the pattern
 * below since it no longer looks at the surrounding "g" at all — see next).
 *
 * fix round 3 finding 1(a): the previous pattern only matched the token when
 * it was directly preceded by `/g/` — but a deep-scrubbed event (see
 * `scrubShareTokensDeep` below) can carry the raw token in shapes that don't
 * look like a URL path at all (an exception frame's `filename`, a `vars`
 * value, an arbitrary breadcrumb string, ...). The token itself
 * (`randomBytes(32).toString('base64url')`) is always EXACTLY 43 base64url
 * characters, so matching that exact run — bounded on both sides by a
 * non-base64url character (or start/end of string) so it can't accidentally
 * slice into the middle of a longer alphanumeric run — catches every shape,
 * not just the URL-path one. It still produces the identical `/g/[redacted]`
 * output for the URL-path case (the `/g/` prefix is left untouched; only the
 * 43-char run after it becomes `[redacted]`).
 */
const BARE_TOKEN_PATTERN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;

export function redactShareToken(url: string): string {
  if (typeof url !== 'string') return url;
  return url.replace(BARE_TOKEN_PATTERN, '[redacted]');
}

/**
 * fix round 3 finding 1(a): the field-by-field scrub in `beforeSend`/
 * `beforeSendTransaction` (touching only `request.url`/`extra.url`/breadcrumb
 * `data.url`) missed the token wherever else the SDK happens to put it —
 * confirmed by the re-reviewer's probe against a REAL `sentry.ts` with a DSN:
 * `contexts.trace.data.url` / `.data["http.url"]` / `.data["http.target"]`
 * (root span attributes from `@sentry/node-core`'s `httpServerSpansIntegration`,
 * copied over by `@sentry/opentelemetry`) and `spans[].data["http.url"|"url.full"]`
 * (the default `nestIntegration`) all carried the raw token on transaction
 * events, and `event.transaction` itself starts as the raw
 * `GET /api/g/<token>` before Express's router layer resolves it to a
 * parameterized route — so an error captured in middleware ships the raw
 * transaction name too.
 *
 * Rather than chase each field individually (and inevitably miss the next
 * one some other integration adds), this walks the WHOLE event tree and
 * applies `redactShareToken` to every string it finds, mutating in place.
 * `seen` guards against reference cycles; `maxDepth` bounds pathological
 * nesting (Sentry events are shallow in practice — this is a safety cap, not
 * a expected-case limit).
 */
export function scrubShareTokensDeep<T>(value: T, seen: WeakSet<object> = new WeakSet(), depth = 0): T {
  if (depth > 12) return value;
  if (typeof value === 'string') return redactShareToken(value) as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  const obj = value as unknown as Record<string | number, unknown>;
  if (seen.has(obj)) return value;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) obj[i] = scrubShareTokensDeep(obj[i], seen, depth + 1);
    return value;
  }
  for (const key of Object.keys(obj)) obj[key] = scrubShareTokensDeep(obj[key], seen, depth + 1);
  return value;
}
