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
 * `contexts.trace.data.url` / `.data["http.url"]` / `.data["http.target"]`,
 * `spans[].data["http.url"|"url.full"]`, and `event.transaction` itself
 * (the raw `GET /api/g/<token>` before Express's router resolves it). So this
 * walks the event tree and applies `redactShareToken` to every string it finds,
 * mutating in place.
 *
 * fix round 4 finding 1 (CRITICAL): round 3's walk wrote back EVERY key of EVERY
 * object it visited — including live SDK objects. Every real transaction event
 * carries `sdkProcessingMetadata.capturedSpanScope` (a live `Scope`); the walk
 * reached `capturedSpanScope._client._promiseBuffer.$` (getter, no setter) and
 * the write threw `Cannot set property $ of #<Object> which has only a getter`
 * — on EVERY transaction on EVERY route. The SDK then dropped the transaction
 * (all APM lost) and captured an internal error event instead, which it never
 * passes through `beforeSend` — so that event shipped `transaction:
 * "POST /api/g/<raw token>/reply"` unscrubbed. The walk now:
 *   - enters ONLY arrays and plain objects (prototype `Object.prototype` or
 *     `null`) — never a `Scope`/`Client`/`Date`/`Map`/class instance. Every
 *     field the SDK actually serializes is plain by the time the hooks run
 *     (`prepareEvent`'s `normalizeEvent` already converted `extra`/`contexts`/
 *     `user`/breadcrumb + span `data` into plain objects);
 *   - skips the top-level `sdkProcessingMetadata` key entirely (SDK-internal,
 *     holds the live scopes). NOT "never sent" — its `dynamicSamplingContext`
 *     becomes the envelope HEADER `trace` (fix round 5): that one field is
 *     handled separately by `redactDynamicSamplingContext` below;
 *   - for an `Error` instance (only reachable when normalization did not run),
 *     redacts its own string properties (incl. `message`/`stack`, which the
 *     SDK's normalizer would serialize) that are writable data properties, and
 *     walks its own plain-object/array/`Error` values — never its getters;
 *   - writes back ONLY when a string actually changed.
 * A throwing getter or a non-writable property holding the token still throws
 * out of here — the callers in `sentry.ts` catch that and fail closed.
 */
const MAX_SCRUB_DEPTH = 12;
const SKIPPED_TOP_LEVEL_KEYS = new Set(['sdkProcessingMetadata']);

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function scrubShareTokensDeep<T>(value: T): T {
  if (typeof value === 'string') return redactShareToken(value) as unknown as T;
  if (value !== null && typeof value === 'object') scrubContainer(value as unknown as object, new WeakSet(), 0);
  return value;
}

function scrubContainer(obj: object, seen: WeakSet<object>, depth: number): void {
  if (depth > MAX_SCRUB_DEPTH || seen.has(obj)) return;
  if (Array.isArray(obj)) {
    seen.add(obj);
    for (let i = 0; i < obj.length; i++) scrubSlot(obj as unknown as Record<number, unknown>, i, seen, depth);
    return;
  }
  if (isPlainObject(obj)) {
    seen.add(obj);
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (depth === 0 && SKIPPED_TOP_LEVEL_KEYS.has(key)) continue;
      scrubSlot(record, key, seen, depth);
    }
    return;
  }
  if (obj instanceof Error) {
    seen.add(obj);
    scrubErrorOwnProperties(obj, seen, depth);
  }
  // anything else (Scope, Client, Date, Map, Buffer, other class instances): never touched
}

function scrubSlot(container: Record<string | number, unknown>, key: string | number, seen: WeakSet<object>, depth: number): void {
  const current = container[key];
  if (typeof current === 'string') {
    const redacted = redactShareToken(current);
    if (redacted !== current) container[key] = redacted;
    return;
  }
  if (current !== null && typeof current === 'object') scrubContainer(current, seen, depth + 1);
}

function scrubErrorOwnProperties(err: Error, seen: WeakSet<object>, depth: number): void {
  const record = err as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(err)) {
    const desc = Object.getOwnPropertyDescriptor(err, key);
    if (!desc || !('value' in desc)) continue; // accessor — never invoke getters on an Error
    const current = desc.value;
    if (typeof current === 'string') {
      const redacted = redactShareToken(current);
      if (redacted !== current && desc.writable) record[key] = redacted;
    } else if (current !== null && typeof current === 'object') {
      scrubContainer(current, seen, depth + 1);
    }
  }
}

/**
 * fix round 5 finding 1: `@sentry/core`'s `createEventEnvelopeHeaders`
 * (utils/envelope.js) copies `event.sdkProcessingMetadata.dynamicSamplingContext`
 * VERBATIM into the envelope header as `trace` — and its `transaction` is the
 * isolation scope's transaction name, which for a share-route request is
 * `POST /api/g/<raw token>/reply` whenever it was captured before Express's router
 * parameterized it. The deep walk never enters `sdkProcessingMetadata`, so this
 * redacts that one field on a NEW DSC object (the SDK caches/shares the DSC —
 * frozen on the root span — so it is never mutated) inside a NEW shallow copy of
 * `sdkProcessingMetadata` (every other entry, e.g. the live `capturedSpanScope`,
 * is carried over by reference, untouched).
 */
export function redactDynamicSamplingContext<T>(event: T): T {
  const e = event as unknown as Record<string, any>;
  const meta = e.sdkProcessingMetadata;
  if (!meta || typeof meta !== 'object') return event;
  const dsc = meta.dynamicSamplingContext;
  if (!dsc || typeof dsc !== 'object') return event;
  const copy: Record<string, unknown> = { ...dsc };
  if (typeof copy.transaction === 'string') copy.transaction = redactShareToken(copy.transaction);
  e.sdkProcessingMetadata = { ...meta, dynamicSamplingContext: copy };
  return event;
}

/**
 * fix round 4 finding 1: last-resort scrub for when `scrubShareTokensDeep`
 * throws inside `beforeSend` (throwing getter, non-writable property, ...).
 * `beforeSend` must still return an event rather than throw — a throwing hook
 * makes the SDK drop the event and capture an internal error event that skips
 * `beforeSend` entirely. Touches only the fields the token is known to reach on
 * an error event, each one guarded on its own so one bad field cannot stop the
 * rest from being scrubbed.
 */
export function shallowScrubShareTokens<T>(event: T): T {
  const e = event as unknown as Record<string, any>;
  const guard = (fn: () => void) => {
    try { fn(); } catch { /* keep going — scrub whatever else we can */ }
  };
  const redactField = (holder: Record<string, any> | undefined, key: string) => {
    if (holder && typeof holder[key] === 'string') holder[key] = redactShareToken(holder[key]);
  };
  guard(() => redactField(e, 'transaction'));
  guard(() => { redactDynamicSamplingContext(e); }); // fix round 5 — envelope header `trace`
  guard(() => redactField(e, 'message'));
  guard(() => redactField(e.request, 'url'));
  guard(() => redactField(e.extra, 'url'));
  guard(() => {
    const data = e.contexts?.trace?.data;
    for (const key of ['url', 'http.url', 'http.target']) guard(() => redactField(data, key));
  });
  guard(() => {
    if (!Array.isArray(e.exception?.values)) return;
    for (const value of e.exception.values) guard(() => redactField(value, 'value'));
  });
  guard(() => {
    if (!Array.isArray(e.breadcrumbs)) return;
    for (const crumb of e.breadcrumbs) guard(() => redactField(crumb?.data, 'url'));
  });
  return event;
}
