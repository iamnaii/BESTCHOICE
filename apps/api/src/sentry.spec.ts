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
 * `Sentry.init()` only runs when `SENTRY_DSN` is set, and reads it at module
 * top-level — so each test sets the env var, resets the module registry, and
 * re-requires both `@sentry/nestjs` (to read the mock instance matching the
 * fresh registry) and `./sentry` (to re-run `Sentry.init()` against it).
 */
jest.mock('@sentry/nestjs', () => ({ init: jest.fn() }));

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
    require('./sentry');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/nestjs');
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    return Sentry.init.mock.calls[0][0];
  }

  it('does not call Sentry.init at all when SENTRY_DSN is unset (unrelated to the scrub, sanity check on the harness)', () => {
    delete process.env.SENTRY_DSN;
    jest.resetModules();
    require('./sentry');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
});
