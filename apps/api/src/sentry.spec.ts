/**
 * fix round 2 finding 1(a): `@sentry/nestjs`'s `requestDataIntegration` (default
 * `url: true`) independently copies the raw request URL onto `event.request.url`
 * for EVERY captured event, bypassing `SentryExceptionFilter`'s own `extra.url`
 * scrub entirely. This spec exercises the `beforeSend`/`beforeSendTransaction`
 * hooks passed to `Sentry.init()` directly (captured off the mocked `init` call)
 * to prove the GFIN share token (`/api/g/<43-char-token>/...`) never survives
 * either hook, on both error events and the ~20%-sampled APM transaction events.
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

  it('beforeSend scrubs the raw share token out of event.request.url', () => {
    const config = loadSentryInitConfig();
    const event = { request: { url: `https://api.example/api/g/${TOKEN}/reply` } };
    const result = config.beforeSend(event);
    expect(result.request.url).toBe('https://api.example/api/g/[redacted]/reply');
  });

  it('beforeSend scrubs event.extra.url — the exact field SentryExceptionFilter itself sets (closes the gap that field alone could not)', () => {
    const config = loadSentryInitConfig();
    const event = { extra: { url: `/api/g/${TOKEN}/zip` } };
    const result = config.beforeSend(event);
    expect(result.extra.url).toBe('/api/g/[redacted]/zip');
  });

  it('beforeSend scrubs a breadcrumb data.url and leaves breadcrumbs without a url untouched', () => {
    const config = loadSentryInitConfig();
    const event = { breadcrumbs: [{ data: { url: `/api/g/${TOKEN}/files/f1` } }, { data: { method: 'GET' } }, {}] };
    const result = config.beforeSend(event);
    expect(result.breadcrumbs[0].data.url).toBe('/api/g/[redacted]/files/f1');
    expect(result.breadcrumbs[1].data.method).toBe('GET');
  });

  it('beforeSend still redacts sensitive request.data keys (pre-existing behaviour — must not regress)', () => {
    const config = loadSentryInitConfig();
    const event = { request: { data: { nationalId: '1234567890123', phone: '0812345678', other: 'keep-me' } } };
    const result = config.beforeSend(event);
    expect(result.request.data.nationalId).toBe('[REDACTED]');
    expect(result.request.data.phone).toBe('[REDACTED]');
    expect(result.request.data.other).toBe('keep-me');
  });

  it('beforeSend leaves an unrelated URL alone', () => {
    const config = loadSentryInitConfig();
    const event = { request: { url: '/api/customers/123' } };
    const result = config.beforeSend(event);
    expect(result.request.url).toBe('/api/customers/123');
  });

  it('beforeSendTransaction scrubs both event.request.url and event.transaction (the ~20% prod tracesSampleRate leak)', () => {
    const config = loadSentryInitConfig();
    const event = { request: { url: `/api/g/${TOKEN}/zip` }, transaction: `GET /api/g/${TOKEN}/zip` };
    const result = config.beforeSendTransaction(event);
    expect(result.request.url).toBe('/api/g/[redacted]/zip');
    expect(result.transaction).toBe('GET /api/g/[redacted]/zip');
  });

  it('beforeSendTransaction leaves an unrelated transaction name/url alone', () => {
    const config = loadSentryInitConfig();
    const event = { request: { url: '/api/customers/123' }, transaction: 'GET /api/customers/:id' };
    const result = config.beforeSendTransaction(event);
    expect(result.request.url).toBe('/api/customers/123');
    expect(result.transaction).toBe('GET /api/customers/:id');
  });
});
