/**
 * fix round 2 finding 1(a): `@sentry/nestjs`'s `requestDataIntegration` (default
 * `url: true`) independently copies the raw request URL onto `event.request.url`
 * for EVERY captured event, bypassing `SentryExceptionFilter`'s own `extra.url`
 * scrub entirely.
 *
 * fix round 3 finding 1(a): a field-by-field scrub (request.url / extra.url /
 * breadcrumb data.url / transaction) still isn't enough — a re-review against a
 * REAL `sentry.ts` with a DSN configured found the token ALSO on
 * `contexts.trace.data.url` / `.data["http.url"]` / `.data["http.target"]` (root
 * span attributes `@sentry/node-core`'s `httpServerSpansIntegration` sets, copied
 * by `@sentry/opentelemetry`) and `spans[].data["http.url"|"url.full"]` (the
 * default `nestIntegration`) on transaction events, and on `event.transaction`
 * itself on error events captured before Express's router resolved the route to
 * its parameterized form. This spec now builds REALISTIC events carrying the
 * token in all of those places and asserts (a) `beforeSendTransaction` drops the
 * whole transaction for a share route, (b) it passes through an unrelated
 * transaction unchanged, and (c) `beforeSend` leaves NO occurrence of the raw
 * token anywhere in the returned error event (not just in the fields the
 * previous, narrower test happened to check).
 *
 * fix round 4 finding 1 (CRITICAL): round 3's deep scrub wrote back every key of
 * every object it visited, including live SDK objects — every REAL transaction
 * carries `sdkProcessingMetadata.capturedSpanScope` (a live Scope) whose
 * `_client._promiseBuffer.$` is getter-only, so `beforeSendTransaction` threw on
 * every transaction on every route (all APM lost + one unscrubbed internal error
 * event per sampled request). The hand-built events above never carried
 * `sdkProcessingMetadata`, so nothing here exercised that path. The
 * "fix round 4" block below builds events with that shape, with non-plain
 * objects, with `Error` instances and with injected scrub failures, and asserts
 * both hooks fail closed instead of throwing. (The real-SDK end-to-end probe is in
 * the task-6 report — fix round 4.)
 *
 * fix round 5 finding 1: `sdkProcessingMetadata` is NOT "never sent" — the SDK
 * copies its `dynamicSamplingContext` verbatim into the envelope HEADER `trace`
 * (`@sentry/core` utils/envelope.js `createEventEnvelopeHeaders`), and its
 * `transaction` carried `POST /api/g/<raw token>/reply` on share-route error
 * envelopes. The tests below now treat the DSC as sent (redacted on a new copy,
 * the shared original never mutated) while the rest of `sdkProcessingMetadata`
 * (the live `capturedSpanScope`) stays untouched; and sampled transactions get
 * the same request-body PII redaction as error events (round 5 Important 2).
 *
 * `Sentry.init()` only runs when `SENTRY_DSN` is set, and reads it at module
 * top-level — so each test sets the env var, resets the module registry, and
 * re-requires both `@sentry/nestjs` (to read the mock instance matching the
 * fresh registry) and `./sentry` (to re-run `Sentry.init()` against it).
 */
jest.mock('@sentry/nestjs', () => ({ init: jest.fn(), nativeNodeFetchIntegration: jest.fn((options) => ({ name: 'NodeFetch', options })) }));

describe('sentry.ts — beforeSend/beforeSendTransaction scrub the GFIN share token', () => {
  const TOKEN = 'A'.repeat(43);
  let previousDsn: string | undefined;

  beforeEach(() => {
    previousDsn = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://fake@sentry.example/1';
    jest.resetModules();
  });

  afterEach(() => {
    if (previousDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previousDsn;
  });

  function loadSentryInitConfig() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./sentry');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/nestjs');
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    return Sentry.init.mock.calls[0][0];
  }

  it('excludes Graph credentials from both native-fetch spans and breadcrumbs at instrumentation time', () => {
    const config = loadSentryInitConfig();
    const integration = config.integrations.find((item: { name: string }) => item.name === 'NodeFetch');
    const token = 'EAA_SYNTHETIC_' + 'secret'.repeat(40); // Facebook tokens are not 43-char GFIN tokens.
    expect(integration.options.ignoreOutgoingRequests(`https://graph.facebook.com/v25.0/debug_token?input_token=${token}`)).toBe(true);
    expect(integration.options.ignoreOutgoingRequests('https://graph.facebook.com/v25.0/me?appsecret_proof=secret-proof')).toBe(true);
    expect(integration.options.ignoreOutgoingRequests('https://other.example/safe')).toBe(false);
    expect(integration.options.ignoreOutgoingRequests('invalid URL')).toBe(true);
    expect(JSON.stringify(config.integrations)).not.toContain(token);
  });

  it('does not call Sentry.init at all when SENTRY_DSN is unset (unrelated to the scrub, sanity check on the harness)', () => {
    delete process.env.SENTRY_DSN;
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./sentry');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/nestjs');
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('beforeSend still redacts sensitive request.data keys (pre-existing behaviour — must not regress)', () => {
    const config = loadSentryInitConfig();
    const event = { request: { data: { nationalId: '1234567890123', phone: '0812345678', other: 'keep-me' } } };
    const result = config.beforeSend(event);
    expect(result.request.data.nationalId).toBe('[REDACTED]');
    expect(result.request.data.phone).toBe('[REDACTED]');
    expect(result.request.data.other).toBe('keep-me');
  });

  it('beforeSend leaves an unrelated event alone', () => {
    const config = loadSentryInitConfig();
    const event = { request: { url: '/api/customers/123' }, transaction: 'GET /api/customers/:id' };
    const result = config.beforeSend(event);
    expect(result.request.url).toBe('/api/customers/123');
    expect(result.transaction).toBe('GET /api/customers/:id');
  });

  describe('a REALISTIC error event carrying the token in every field a re-review found it (fix round 3 finding 1a)', () => {
    function buildErrorEvent() {
      return {
        transaction: `GET /api/g/${TOKEN}`, // captured before Express's router resolved the parameterized route
        request: { url: `https://api.example/api/g/${TOKEN}/reply` },
        contexts: {
          trace: {
            trace_id: 'abc123',
            span_id: 'def456',
            data: {
              url: `https://api.example/api/g/${TOKEN}/zip`,
              'http.url': `https://api.example/api/g/${TOKEN}/zip`,
              'http.target': `/api/g/${TOKEN}/zip`,
            },
          },
        },
        breadcrumbs: [{ category: 'http', data: { url: `/api/g/${TOKEN}/files/f1`, method: 'GET' } }],
        exception: {
          values: [
            {
              type: 'Error',
              value: `boom while handling /api/g/${TOKEN}`,
              stacktrace: {
                frames: [
                  {
                    // a realistic source filename (never carries the token itself) — the token
                    // shows up in the frame's captured local variables instead, which is the
                    // actual "filename/vars" leak surface the finding calls out
                    filename: '/app/dist/src/modules/external-finance-application/finance-share-public.controller.js',
                    vars: { token: TOKEN, url: `/api/g/${TOKEN}/reply`, note: 'unrelated' },
                  },
                ],
              },
            },
          ],
        },
      };
    }

    it('beforeSend leaves no occurrence of the raw token anywhere in the returned event', () => {
      const config = loadSentryInitConfig();
      const event = buildErrorEvent();
      const result = config.beforeSend(event);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      // sanity: the scrub actually ran (didn't just strip everything) — the
      // share-route shape is still recognizable, just redacted
      expect(result.transaction).toBe('GET /api/g/[redacted]');
      expect(result.request.url).toBe('https://api.example/api/g/[redacted]/reply');
      expect(result.contexts.trace.data.url).toBe('https://api.example/api/g/[redacted]/zip');
      expect(result.contexts.trace.data['http.target']).toBe('/api/g/[redacted]/zip');
      expect(result.breadcrumbs[0].data.url).toBe('/api/g/[redacted]/files/f1');
      expect(result.exception.values[0].value).toBe('boom while handling /api/g/[redacted]');
      expect(result.exception.values[0].stacktrace.frames[0].filename).toBe(
        '/app/dist/src/modules/external-finance-application/finance-share-public.controller.js',
      ); // untouched — an ordinary source path, never carried the token
      expect(result.exception.values[0].stacktrace.frames[0].vars.token).toBe('[redacted]');
      expect(result.exception.values[0].stacktrace.frames[0].vars.url).toBe('/api/g/[redacted]/reply');
      expect(result.exception.values[0].stacktrace.frames[0].vars.note).toBe('unrelated'); // untouched
    });
  });

  describe('a REALISTIC transaction event (fix round 3 finding 1a/1b)', () => {
    function buildShareTransactionEvent() {
      return {
        type: 'transaction' as const,
        transaction: `GET /api/g/${TOKEN}/zip`,
        request: { url: `/api/g/${TOKEN}/zip` },
        contexts: {
          trace: {
            trace_id: 'abc123',
            span_id: 'def456',
            data: {
              url: `/api/g/${TOKEN}/zip`,
              'http.url': `https://api.example/api/g/${TOKEN}/zip`,
              'http.target': `/api/g/${TOKEN}/zip`,
            },
          },
        },
        spans: [
          {
            span_id: 'span1',
            trace_id: 'abc123',
            start_timestamp: 0,
            description: `GET /api/g/${TOKEN}/zip`,
            data: { 'http.url': `https://api.example/api/g/${TOKEN}/zip`, 'url.full': `https://api.example/api/g/${TOKEN}/zip` },
          },
        ],
      };
    }

    it('drops the whole transaction for a share-route hit, even though the token only shows up in span/trace-context attributes', () => {
      const config = loadSentryInitConfig();
      const result = config.beforeSendTransaction(buildShareTransactionEvent());
      expect(result).toBeNull();
    });

    it('drops a share-route transaction identified ONLY via contexts.trace.data (request.url/transaction give no hint at all — a generic/unresolved name)', () => {
      const config = loadSentryInitConfig();
      const event = buildShareTransactionEvent();
      // simulate a case where transaction/request.url carry no share-route hint
      // whatsoever (e.g. an unresolved generic name) while the raw http
      // instrumentation attributes on contexts.trace.data still carry the real
      // URL independently — this is exactly the gap the re-reviewer's probe found
      event.transaction = 'GET /';
      event.request.url = '/';
      const result = config.beforeSendTransaction(event);
      expect(result).toBeNull();
    });

    it('passes through an unrelated transaction unchanged (scrubbed, not dropped)', () => {
      const config = loadSentryInitConfig();
      const event = {
        type: 'transaction' as const,
        transaction: 'GET /api/customers/:id',
        request: { url: '/api/customers/123' },
        contexts: { trace: { trace_id: 'x', span_id: 'y', data: { url: '/api/customers/123', 'http.target': '/api/customers/123' } } },
        spans: [{ span_id: 's1', trace_id: 'x', start_timestamp: 0, description: 'GET /api/customers/123', data: {} }],
      };
      const result = config.beforeSendTransaction(event);
      expect(result).not.toBeNull();
      expect(result.transaction).toBe('GET /api/customers/:id');
      expect(result.request.url).toBe('/api/customers/123');
    });
  });

  it('the share-route match is case-insensitive (Express routing is case-insensitive) — fix round 3 finding 1c', () => {
    const config = loadSentryInitConfig();
    const event = {
      type: 'transaction' as const,
      transaction: `GET /api/G/${TOKEN}/zip`,
      request: { url: `/api/G/${TOKEN}/zip` },
    };
    const result = config.beforeSendTransaction(event);
    expect(result).toBeNull();
  });

  // real SDK event shapes are built loosely on purpose (live Scope / getters / Error instances)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  describe('fix round 4 finding 1 — hooks never throw on real SDK event shapes and fail closed', () => {
    /**
     * Mirrors the real chain the re-reviewer hit: `sdkProcessingMetadata.capturedSpanScope`
     * → `_client` → `_promiseBuffer` → `$` (getter, no setter). The getter returns a
     * token-bearing STRING on purpose: if the walk entered `sdkProcessingMetadata` at all
     * it would try to write the redacted value back and throw.
     */
    function buildCapturedSpanScope() {
      const promiseBuffer: Record<string, unknown> = { _buffer: [] };
      Object.defineProperty(promiseBuffer, '$', { get: () => `GET /api/g/${TOKEN}`, enumerable: true });
      return { _client: { _options: { dsn: 'https://fake@sentry.example/1' }, _promiseBuffer: promiseBuffer }, _level: 'info' };
    }

    function buildTransactionEvent(route: string, dscTransaction: string = route) {
      return {
        type: 'transaction' as const,
        transaction: route,
        request: { url: `https://api.example${route.replace(/^GET /, '')}` },
        contexts: { trace: { trace_id: 't', span_id: 's', data: { url: route.replace(/^GET /, '') } } },
        spans: [{ span_id: 's1', trace_id: 't', start_timestamp: 0, data: { 'url.full': `https://api.example/api/customers/1?ref=${TOKEN}` } }],
        sdkProcessingMetadata: {
          capturedSpanScope: buildCapturedSpanScope(),
          normalizedRequest: { url: `https://api.example/api/customers/1?ref=${TOKEN}` },
          // becomes the envelope HEADER `trace` (fix round 5) — frozen like a DSC the SDK caches on the root span
          dynamicSamplingContext: Object.freeze({ trace_id: 't', public_key: 'pk', sample_rate: '1', sampled: 'true', transaction: dscTransaction }),
        },
      };
    }

    it('(a) a NON-share transaction carrying a getter-only property deep inside sdkProcessingMetadata is returned (not null, no throw) and sdkProcessingMetadata is left untouched', () => {
      const config = loadSentryInitConfig();
      // defensive (fix round 5): a token-shaped value in the DSC transaction of a transaction we still send is redacted
      const event = buildTransactionEvent('GET /api/customers/:id', `GET /api/customers/1?ref=${TOKEN}`);
      const scope = event.sdkProcessingMetadata.capturedSpanScope;
      const sharedDsc = event.sdkProcessingMetadata.dynamicSamplingContext;
      let result: any;
      expect(() => { result = config.beforeSendTransaction(event); }).not.toThrow();
      expect(result).not.toBeNull();
      expect(result.transaction).toBe('GET /api/customers/:id');
      // the DSC (→ envelope header `trace`) is a NEW redacted copy; the shared original is not mutated
      expect(result.sdkProcessingMetadata.dynamicSamplingContext).toEqual({ ...sharedDsc, transaction: 'GET /api/customers/1?ref=[redacted]' });
      expect(result.sdkProcessingMetadata.dynamicSamplingContext).not.toBe(sharedDsc);
      expect(sharedDsc.transaction).toBe(`GET /api/customers/1?ref=${TOKEN}`);
      // the rest of sdkProcessingMetadata: same objects, same strings — never walked
      expect(result.sdkProcessingMetadata.capturedSpanScope).toBe(scope);
      expect(result.sdkProcessingMetadata.normalizedRequest.url).toBe(`https://api.example/api/customers/1?ref=${TOKEN}`);
      expect((scope._client._promiseBuffer as Record<string, unknown>).$).toBe(`GET /api/g/${TOKEN}`);
      // everything the SDK actually sends is still scrubbed
      expect(result.spans[0].data['url.full']).toBe('https://api.example/api/customers/1?ref=[redacted]');
    });

    it('(a2) a non-plain object (live SDK class instance) anywhere in the event is never walked or written to', () => {
      const config = loadSentryInitConfig();
      class FakeClient {
        readonly note = `/api/g/${TOKEN}`;
        get $() { return `/api/g/${TOKEN}`; }
      }
      const client = new FakeClient();
      Object.defineProperty(client, 'own$', { get: () => `/api/g/${TOKEN}`, enumerable: true });
      const event: any = { ...buildTransactionEvent('GET /api/customers/:id'), extra: { client } };
      let result: any;
      expect(() => { result = config.beforeSendTransaction(event); }).not.toThrow();
      expect(result).not.toBeNull();
      expect(result.extra.client).toBe(client);
      expect(client.note).toBe(`/api/g/${TOKEN}`); // untouched — not a plain object
    });

    it('(b) the same real-SDK shape on a SHARE route → null (dropped), no throw', () => {
      const config = loadSentryInitConfig();
      let result: any = 'not-called';
      expect(() => { result = config.beforeSendTransaction(buildTransactionEvent(`GET /api/g/${TOKEN}/reply`)); }).not.toThrow();
      expect(result).toBeNull();
      const parameterized = buildTransactionEvent('GET /api/g/:token/zip');
      expect(config.beforeSendTransaction(parameterized)).toBeNull();
    });

    it('(b2) a scrub failure inside beforeSendTransaction on a NON-share route fails closed → null, never throws', () => {
      const config = loadSentryInitConfig();
      const event: any = buildTransactionEvent('GET /api/customers/:id');
      const poison = {};
      Object.defineProperty(poison, 'boom', { get() { throw new Error('getter exploded'); }, enumerable: true });
      event.contexts.poison = poison;
      let result: any = 'not-called';
      expect(() => { result = config.beforeSendTransaction(event); }).not.toThrow();
      expect(result).toBeNull();
    });

    it('(c) an error event with an Error instance under extra + the token in transaction / contexts.trace.data / breadcrumb / request.url / frame vars → no token anywhere, no throw', () => {
      const config = loadSentryInitConfig();
      const err = new Error(`storage read failed for /api/g/${TOKEN}/files/f1`);
      (err as Error & { url?: string }).url = `/api/g/${TOKEN}/zip`;
      const event: any = {
        transaction: `POST /api/g/${TOKEN}/reply`,
        request: { url: `https://api.example/api/g/${TOKEN}/reply`, data: '{"action":"ACK","name":"คุณเอ"}' },
        contexts: { trace: { trace_id: 't', span_id: 's', data: { url: `/api/g/${TOKEN}/reply`, 'http.target': `/api/g/${TOKEN}/reply` } } },
        breadcrumbs: [{ category: 'http', data: { url: `/api/g/${TOKEN}/files/f1` } }],
        extra: { url: `/api/g/${TOKEN}/reply`, cause: err },
        exception: { values: [{ type: 'Error', value: `boom /api/g/${TOKEN}`, stacktrace: { frames: [{ filename: '/app/dist/x.js', vars: { token: TOKEN } }] } }] },
        sdkProcessingMetadata: {
          capturedSpanScope: buildCapturedSpanScope(),
          dynamicSamplingContext: Object.freeze({ trace_id: 't', public_key: 'pk', sampled: 'true', transaction: `POST /api/g/${TOKEN}/reply` }),
        },
      };
      let result: any;
      expect(() => { result = config.beforeSend(event); }).not.toThrow();
      expect(result).not.toBeNull();
      // what the SDK sends = the event item (minus sdkProcessingMetadata) + the envelope header
      // `trace` = sdkProcessingMetadata.dynamicSamplingContext (fix round 5 — NOT "never sent")
      const { sdkProcessingMetadata: meta, ...item } = result;
      expect(JSON.stringify(item)).not.toContain(TOKEN);
      expect(JSON.stringify(meta.dynamicSamplingContext)).not.toContain(TOKEN);
      expect(meta.dynamicSamplingContext.transaction).toBe('POST /api/g/[redacted]/reply');
      expect(err.message).toBe('storage read failed for /api/g/[redacted]/files/f1'); // what the SDK normalizer would serialize
      expect(err.stack).not.toContain(TOKEN);
      expect(result.transaction).toBe('POST /api/g/[redacted]/reply');
      expect(result.contexts.trace.data['http.target']).toBe('/api/g/[redacted]/reply');
      expect(result.exception.values[0].stacktrace.frames[0].vars.token).toBe('[redacted]');
    });

    it('(d) a scrub failure injected via a throwing getter in beforeSend → the shallow fallback still redacts transaction / request.url / extra.url / message / breadcrumb url and returns the event', () => {
      // spy on the fallback through the same module instance sentry.ts will import
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const util = require('./utils/redact-share-token.util');
      const fallback = jest.spyOn(util, 'shallowScrubShareTokens');
      const config = loadSentryInitConfig();
      const poison = {};
      Object.defineProperty(poison, 'boom', { get() { throw new Error('getter exploded'); }, enumerable: true });
      // `contexts` first so the deep walk throws BEFORE it reaches any other field —
      // everything redacted below is the fallback's work, not the deep walk's
      const event: any = {
        contexts: { poison },
        sdkProcessingMetadata: { dynamicSamplingContext: { trace_id: 't', transaction: `GET /api/g/${TOKEN}` } },
        transaction: `GET /api/g/${TOKEN}`,
        message: `failed /api/g/${TOKEN}/zip`,
        request: { url: `https://api.example/api/g/${TOKEN}/reply` },
        extra: { url: `/api/g/${TOKEN}/reply` },
        breadcrumbs: [{ category: 'http', data: { url: `/api/g/${TOKEN}/files/f1` } }],
      };
      let result: any;
      expect(() => { result = config.beforeSend(event); }).not.toThrow();
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(result).toBe(event);
      expect(result.transaction).toBe('GET /api/g/[redacted]');
      expect(result.message).toBe('failed /api/g/[redacted]/zip');
      expect(result.request.url).toBe('https://api.example/api/g/[redacted]/reply');
      expect(result.extra.url).toBe('/api/g/[redacted]/reply');
      expect(result.breadcrumbs[0].data.url).toBe('/api/g/[redacted]/files/f1');
      expect(result.sdkProcessingMetadata.dynamicSamplingContext.transaction).toBe('GET /api/g/[redacted]'); // fix round 5
    });

    it('(e) fix round 5 — a DSC carrying the token (envelope header `trace`) comes out redacted on a new copy, while the rest of sdkProcessingMetadata (live capturedSpanScope with a getter-only prop) is untouched', () => {
      const config = loadSentryInitConfig();
      const scope = buildCapturedSpanScope();
      const sharedDsc = Object.freeze({ trace_id: 'abc', public_key: 'pk', sample_rate: '0.2', sampled: 'true', environment: 'production', transaction: `POST /api/g/${TOKEN}/reply` });
      const event: any = {
        transaction: 'POST /api/g/:token/reply',
        request: { url: `https://api.example/api/g/${TOKEN}/reply` },
        sdkProcessingMetadata: { capturedSpanScope: scope, dynamicSamplingContext: sharedDsc },
      };
      let result: any;
      expect(() => { result = config.beforeSend(event); }).not.toThrow();
      expect(result.sdkProcessingMetadata.dynamicSamplingContext).toEqual({ ...sharedDsc, transaction: 'POST /api/g/[redacted]/reply' });
      expect(sharedDsc.transaction).toBe(`POST /api/g/${TOKEN}/reply`); // the shared/cached original is never mutated
      expect(result.sdkProcessingMetadata.capturedSpanScope).toBe(scope);
      expect((scope._client._promiseBuffer as Record<string, unknown>).$).toBe(`GET /api/g/${TOKEN}`);
      expect(result.request.url).toBe('https://api.example/api/g/[redacted]/reply');
    });

    it('fix round 5 (Important 1) — no trace headers (sentry-trace / baggage) are propagated to ANY outgoing request', () => {
      const config = loadSentryInitConfig();
      // `baggage` carried sentry-transaction=GET%20%2Fapi%2Fg%2F<raw token> to the storage backend and LINE;
      // [] (not undefined — undefined means "propagate everywhere") = propagate to none
      expect(config.tracePropagationTargets).toEqual([]);
    });

    it('fix round 5 (Important 2) — beforeSendTransaction redacts request-body PII on the transactions it still sends', () => {
      const config = loadSentryInitConfig();
      const post = (data: unknown) => ({
        type: 'transaction' as const,
        transaction: 'POST /api/customers',
        request: { url: 'https://api.example/api/customers', method: 'POST', data },
        contexts: { trace: { trace_id: 't', span_id: 's', data: { url: '/api/customers' } } },
      });
      const fromString = config.beforeSendTransaction(post('{"firstName":"สมหญิง","phone":"0812345678","nationalId":"1101700203451"}'));
      expect(fromString).not.toBeNull();
      expect(JSON.parse(fromString.request.data)).toEqual({ firstName: 'สมหญิง', phone: '[REDACTED]', nationalId: '[REDACTED]' });
      const fromObject = config.beforeSendTransaction(post({ phone: '0812345678', password: 'x', note: 'ok' }));
      expect(fromObject.request.data).toEqual({ phone: '[REDACTED]', password: '[REDACTED]', note: 'ok' });
      const form = config.beforeSendTransaction(post('nationalId=1101700203451&note=ok'));
      expect(form.request.data).toBe('[REDACTED]');
    });

    it('beforeSend handles the REAL request.data shape (the raw body STRING) without throwing and still redacts PII', () => {
      const config = loadSentryInitConfig();
      const json = config.beforeSend({ request: { data: '{"phone":"0812345678","nationalId":"1101700203451","note":"ok"}' } });
      expect(JSON.parse(json.request.data)).toEqual({ phone: '[REDACTED]', nationalId: '[REDACTED]', note: 'ok' });
      // form-encoded / truncated-JSON body that mentions a sensitive key → replaced whole
      const form = config.beforeSend({ request: { data: 'phone=0812345678&note=ok' } });
      expect(form.request.data).toBe('[REDACTED]');
      const truncated = config.beforeSend({ request: { data: '{"nationalId":"1101700203451","note":"aaaa...' } });
      expect(truncated.request.data).toBe('[REDACTED]');
      // unrelated body untouched
      const plain = config.beforeSend({ request: { data: '{"action":"ACK"}' } });
      expect(plain.request.data).toBe('{"action":"ACK"}');
    });
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /**
   * Task 21 fix round 1 (I-1): the web POSTs the LINE id_token (+ the tab nonce) to
   * `POST /line-oa/line-login/verify`; a sampled transaction (prod 20%) and the 503 capture
   * carry that body. LIFF pages also send the id_token as the `X-Liff-Id-Token` header and as
   * `?idToken=` on download links (LiffTokenGuard) — headers + query reach `request.headers`,
   * `request.url`, `request.query_string`, root-span `http.target`/`url.full`/`url.query` and
   * `spans[].data`. A LINE id_token can be replayed against LINE /verify until it expires.
   * The nonce here is 46 chars on purpose — NOT the 43-char share-token shape the deep scrub
   * already catches — so these tests prove the key/param redaction itself.
   */
  describe('Task 21 fix round 1 (I-1) — LINE id_token / nonce never reach Sentry', () => {
    const SIGNATURE = 'S'.repeat(86);
    const JWT = `eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJVMTIzNCIsIm5vbmNlIjoiYWJjIn0.${SIGNATURE}`;
    const NONCE = `tab-nonce_${'N'.repeat(36)}`;
    const leaks = (value: unknown) => {
      const text = JSON.stringify(value);
      return text.includes(SIGNATURE) || text.includes(NONCE);
    };
    const VERIFY_URL = 'https://api.example/api/line-oa/line-login/verify';
    const PDF_PATH = `/api/line-oa/liff/receipts/r1/pdf?idToken=${JWT}&download=1`;

    it('verify body (raw JSON string, the real shape) is redacted on error events', () => {
      const config = loadSentryInitConfig();
      const event = config.beforeSend({
        request: {
          url: VERIFY_URL,
          method: 'POST',
          data: JSON.stringify({ idToken: JWT, nonce: NONCE }),
        },
      });
      expect(JSON.parse(event.request.data)).toEqual({
        idToken: '[REDACTED]',
        nonce: '[REDACTED]',
      });
      expect(leaks(event)).toBe(false);
    });

    it('verify body is redacted on the sampled transaction too (object and form-encoded shapes)', () => {
      const config = loadSentryInitConfig();
      const tx = (data: unknown) => ({
        type: 'transaction' as const,
        transaction: 'POST /api/line-oa/line-login/verify',
        request: { url: VERIFY_URL, method: 'POST', data },
        contexts: {
          trace: { trace_id: 't', span_id: 's', data: { url: '/api/line-oa/line-login/verify' } },
        },
      });
      const fromString = config.beforeSendTransaction(
        tx(JSON.stringify({ idToken: JWT, nonce: NONCE })),
      );
      expect(fromString).not.toBeNull();
      expect(JSON.parse(fromString.request.data)).toEqual({
        idToken: '[REDACTED]',
        nonce: '[REDACTED]',
      });
      const fromObject = config.beforeSendTransaction(
        tx({ idToken: JWT, nonce: NONCE, keep: 'ok' }),
      );
      expect(fromObject.request.data).toEqual({
        idToken: '[REDACTED]',
        nonce: '[REDACTED]',
        keep: 'ok',
      });
      const form = config.beforeSendTransaction(
        tx(`id_token=${JWT}&client_id=2009442540&nonce=${NONCE}`),
      );
      expect(form.request.data).toBe('[REDACTED]');
      expect([fromString, fromObject, form].some(leaks)).toBe(false);
    });

    it('?idToken= in the URL / query string / span attributes is redacted on transactions (M-3 download links)', () => {
      const config = loadSentryInitConfig();
      const event = config.beforeSendTransaction({
        type: 'transaction' as const,
        transaction: 'GET /api/line-oa/liff/receipts/:id/pdf',
        request: {
          url: `https://api.example${PDF_PATH}`,
          method: 'GET',
          query_string: `idToken=${JWT}&download=1`,
        },
        contexts: {
          trace: {
            trace_id: 't',
            span_id: 's',
            data: {
              'http.target': PDF_PATH,
              'url.full': `https://api.example${PDF_PATH}`,
              'url.query': `idToken=${JWT}&download=1`,
            },
          },
        },
        spans: [{ span_id: 'c', data: { 'http.url': `https://api.example${PDF_PATH}` } }],
      });
      expect(event).not.toBeNull();
      expect(leaks(event)).toBe(false);
      expect(event.request.query_string).toBe('idToken=[redacted]&download=1');
      expect(event.request.url).toBe(
        'https://api.example/api/line-oa/liff/receipts/r1/pdf?idToken=[redacted]&download=1',
      );
    });

    it('?idToken= / id_token= is redacted on error events (url, query string, breadcrumbs) and in object query form', () => {
      const config = loadSentryInitConfig();
      const event = config.beforeSend({
        request: {
          url: `https://api.example${PDF_PATH}`,
          query_string: `download=1&id_token=${JWT}`,
        },
        breadcrumbs: [{ category: 'http', data: { url: `https://api.example${PDF_PATH}` } }],
        exception: { values: [{ type: 'Error', value: `GET ${PDF_PATH} failed` }] },
      });
      expect(leaks(event)).toBe(false);
      expect(event.request.query_string).toBe('download=1&id_token=[redacted]');
      const objectForm = config.beforeSend({
        request: { query_string: { idToken: JWT, download: '1' } },
      });
      expect(objectForm.request.query_string).toEqual({ idToken: '[REDACTED]', download: '1' });
      const pairForm = config.beforeSend({
        request: {
          query_string: [
            ['idToken', JWT],
            ['download', '1'],
          ],
        },
      });
      expect(pairForm.request.query_string).toEqual([
        ['idToken', '[REDACTED]'],
        ['download', '1'],
      ]);
    });

    it('the X-Liff-Id-Token header is redacted (any case) on error events and transactions', () => {
      const config = loadSentryInitConfig();
      const error = config.beforeSend({
        request: { headers: { 'x-liff-id-token': JWT, accept: 'application/json' } },
      });
      expect(error.request.headers).toEqual({
        'x-liff-id-token': '[REDACTED]',
        accept: 'application/json',
      });
      const tx = config.beforeSendTransaction({
        type: 'transaction' as const,
        transaction: 'POST /api/chatbot/finance/liff/request-otp',
        request: { headers: { 'X-Liff-Id-Token': JWT } },
      });
      expect(tx.request.headers['X-Liff-Id-Token']).toBe('[REDACTED]');
      expect([error, tx].some(leaks)).toBe(false);
    });
  });

  /**
   * Task 22 fix round 1 (M-6): the single-use LIFF download ticket rides as `?dl=`
   * (`LiffDownloadController` — receipts + contract document GETs). A minted ticket is 43-char
   * base64url, which the deep scrub's bare-token pattern already catches — these tests use a
   * 49-char value on purpose so they prove the param is redacted by NAME (a re-encoded / truncated
   * ticket or a future ticket format must not leak through on the shape check alone).
   */
  describe('Task 22 fix round 1 (M-6) — the ?dl= download ticket is redacted by name', () => {
    const TICKET = `dlticket_${'T'.repeat(40)}`;
    const leaks = (value: unknown) => JSON.stringify(value).includes(TICKET);
    const PDF_PATH = `/api/line-oa/liff/receipts/r1/download?dl=${TICKET}&download=1`;

    it('?dl= in the URL / query string / span attributes is redacted on transactions', () => {
      const config = loadSentryInitConfig();
      const event = config.beforeSendTransaction({
        type: 'transaction' as const,
        transaction: 'GET /api/line-oa/liff/receipts/:receiptId/download',
        request: {
          url: `https://api.example${PDF_PATH}`,
          method: 'GET',
          query_string: `dl=${TICKET}&download=1`,
        },
        contexts: {
          trace: {
            trace_id: 't',
            span_id: 's',
            data: {
              'http.target': PDF_PATH,
              'url.full': `https://api.example${PDF_PATH}`,
              'url.query': `dl=${TICKET}&download=1`,
            },
          },
        },
        spans: [{ span_id: 'c', data: { 'http.url': `https://api.example${PDF_PATH}` } }],
      });
      expect(event).not.toBeNull();
      expect(leaks(event)).toBe(false);
      expect(event.request.query_string).toBe('dl=[redacted]&download=1');
      expect(event.request.url).toBe(
        'https://api.example/api/line-oa/liff/receipts/r1/download?dl=[redacted]&download=1',
      );
    });

    it('?dl= is redacted on error events (url, query string, breadcrumbs, message) and in object / pair query form', () => {
      const config = loadSentryInitConfig();
      const event = config.beforeSend({
        request: {
          url: `https://api.example${PDF_PATH}`,
          query_string: `download=1&dl=${TICKET}`,
        },
        breadcrumbs: [{ category: 'http', data: { url: `https://api.example${PDF_PATH}` } }],
        exception: { values: [{ type: 'Error', value: `GET ${PDF_PATH} failed` }] },
      });
      expect(leaks(event)).toBe(false);
      expect(event.request.query_string).toBe('download=1&dl=[redacted]');
      const objectForm = config.beforeSend({
        request: { query_string: { dl: TICKET, download: '1' } },
      });
      expect(objectForm.request.query_string).toEqual({ dl: '[REDACTED]', download: '1' });
      const pairForm = config.beforeSend({
        request: {
          query_string: [
            ['DL', TICKET],
            ['download', '1'],
          ],
        },
      });
      expect(pairForm.request.query_string).toEqual([
        ['DL', '[REDACTED]'],
        ['download', '1'],
      ]);
    });

    it('look-alike params (download=, idl=, xdl=) are left alone', () => {
      const config = loadSentryInitConfig();
      const event = config.beforeSend({
        request: { query_string: 'download=1&idl=abc&xdl=def' },
      });
      expect(event.request.query_string).toBe('download=1&idl=abc&xdl=def');
    });
  });
});
