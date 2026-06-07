import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { LineWebhookGuard } from './line-webhook.guard';

/**
 * Characterization (golden) tests for LineWebhookGuard — the LINE webhook
 * HMAC-SHA256 signature verification gate (X-Line-Signature).
 *
 * SECURITY PATH: locks the exact accept/reject behavior so a future refactor
 * cannot silently weaken signature verification. Expected signatures are built
 * here with node:crypto exactly as the guard does:
 *     createHmac('SHA256', channelSecret).update(rawBody).digest('base64')
 *
 * Mock-based unit test — no DB. IntegrationConfigService + WebhookAnomalyService
 * are plain object mocks injected through the constructor.
 */

const CHANNEL_SECRET = 'test-channel-secret-0123456789abcdef';

/** Sign a raw body the same way LINE (and the guard) does. */
function signBody(secret: string, rawBody: Buffer): string {
  return createHmac('SHA256', secret).update(rawBody).digest('base64');
}

describe('LineWebhookGuard', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let integrationConfig: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let anomaly: any;
  let guard: LineWebhookGuard;

  // Preserve NODE_ENV across the suite (the "missing secret" branch reads it).
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    integrationConfig = {
      getValue: jest.fn().mockResolvedValue(CHANNEL_SECRET),
    };
    anomaly = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    guard = new LineWebhookGuard(integrationConfig, anomaly);
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });

  /** Build a minimal ExecutionContext wrapping a fake express request. */
  function makeContext(req: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  }

  /** A valid LINE webhook payload (LINE sends a JSON envelope). */
  const PAYLOAD = JSON.stringify({
    destination: 'U1234567890',
    events: [{ type: 'message', message: { type: 'text', text: 'สวัสดี' } }],
  });
  const RAW_BODY = Buffer.from(PAYLOAD, 'utf8');

  it('accepts a request whose X-Line-Signature is a correct base64 HMAC-SHA256 of the raw body', async () => {
    const signature = signBody(CHANNEL_SECRET, RAW_BODY);
    // Sanity: the guard recomputes the same digest, so this is the exact value it expects.
    expect(signature).toBe(
      createHmac('SHA256', CHANNEL_SECRET).update(RAW_BODY).digest('base64'),
    );

    const ctx = makeContext({
      ip: '203.0.113.9',
      headers: { 'x-line-signature': signature, 'user-agent': 'LineBotWebhook/2.0' },
      rawBody: RAW_BODY,
      body: JSON.parse(PAYLOAD),
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // A successful verification must NOT record any anomaly.
    expect(anomaly.record).not.toHaveBeenCalled();
  });

  it('rejects a tampered body (valid signature for the ORIGINAL body, but rawBody mutated) and records invalid_signature', async () => {
    // Signature is computed over the untampered payload...
    const signature = signBody(CHANNEL_SECRET, RAW_BODY);
    // ...but the request now carries a different raw body (attacker swapped the amount/text).
    const tamperedBody = Buffer.from(
      JSON.stringify({ destination: 'U1234567890', events: [{ type: 'evil' }] }),
      'utf8',
    );

    const ctx = makeContext({
      ip: '198.51.100.7',
      headers: { 'x-line-signature': signature, 'user-agent': 'curl/8.0' },
      rawBody: tamperedBody,
      body: {},
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid LINE signature');
    expect(anomaly.record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'line-shop', reason: 'invalid_signature' }),
    );
  });

  it('rejects a signature produced with the WRONG channel secret (forged sender)', async () => {
    // Attacker signs the real body but does not know the channel secret.
    const forgedSignature = signBody('attacker-guessed-secret', RAW_BODY);
    expect(forgedSignature).not.toBe(signBody(CHANNEL_SECRET, RAW_BODY));

    const ctx = makeContext({
      ip: '198.51.100.20',
      headers: { 'x-line-signature': forgedSignature },
      rawBody: RAW_BODY,
      body: JSON.parse(PAYLOAD),
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid LINE signature');
    expect(anomaly.record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'line-shop', reason: 'invalid_signature' }),
    );
  });

  it('rejects when the X-Line-Signature header is entirely absent (records missing_signature, not invalid_signature)', async () => {
    const ctx = makeContext({
      ip: '203.0.113.50',
      headers: {}, // no x-line-signature
      rawBody: RAW_BODY,
      body: JSON.parse(PAYLOAD),
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow('Missing LINE signature');
    expect(anomaly.record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'line-shop', reason: 'missing_signature' }),
    );
  });

  it('falls back to JSON.stringify(request.body) when rawBody is absent — signature over the stringified body passes', async () => {
    // The guard does: body = rawBody ?? Buffer.from(JSON.stringify(request.body)).
    // With rawBody undefined, the HMAC is taken over Buffer.from(JSON.stringify(body)).
    const parsed = { destination: 'U999', events: [] };
    const stringified = Buffer.from(JSON.stringify(parsed));
    const signature = signBody(CHANNEL_SECRET, stringified);

    const ctx = makeContext({
      ip: '203.0.113.77',
      headers: { 'x-line-signature': signature },
      // rawBody intentionally omitted → triggers the JSON.stringify fallback path
      body: parsed,
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(anomaly.record).not.toHaveBeenCalled();
  });

  it('an empty raw body is verifiable: HMAC of an empty buffer matches and passes', async () => {
    const emptyBody = Buffer.from('', 'utf8');
    const signature = signBody(CHANNEL_SECRET, emptyBody);

    const ctx = makeContext({
      ip: '203.0.113.88',
      headers: { 'x-line-signature': signature },
      rawBody: emptyBody,
      body: {},
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  describe('missing channel secret', () => {
    it('in DEV (NODE_ENV !== production) skips verification and returns true even with a bogus signature', async () => {
      process.env.NODE_ENV = 'development';
      integrationConfig.getValue.mockResolvedValue(''); // secret not configured

      const ctx = makeContext({
        ip: '127.0.0.1',
        headers: { 'x-line-signature': 'anything-goes-in-dev' },
        rawBody: RAW_BODY,
        body: JSON.parse(PAYLOAD),
      });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      // Dev skip must not flag an anomaly.
      expect(anomaly.record).not.toHaveBeenCalled();
    });

    it('in PRODUCTION refuses the webhook and records missing_secret', async () => {
      process.env.NODE_ENV = 'production';
      integrationConfig.getValue.mockResolvedValue('');

      const ctx = makeContext({
        ip: '203.0.113.200',
        headers: { 'x-line-signature': 'irrelevant' },
        rawBody: RAW_BODY,
        body: JSON.parse(PAYLOAD),
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Webhook signature verification not configured',
      );
      expect(anomaly.record).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'line-shop', reason: 'missing_secret' }),
      );
    });
  });
});
