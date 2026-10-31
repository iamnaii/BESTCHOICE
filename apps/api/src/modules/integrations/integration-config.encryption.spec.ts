import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import { encryptPII } from '../../utils/crypto.util';
import { IntegrationConfigService } from './integration-config.service';

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

/**
 * INTEGRATION_ENCRYPTION_KEY handling (Task 26).
 *
 * An encrypted credential in `system_config` that this process cannot decrypt
 * (key missing, wrong key, malformed key) must fail closed: `getValue` returns
 * `undefined` ("not configured"), never the ciphertext and never a throw into
 * business code, and nothing that leaves the process (logs, Sentry) carries the
 * value or the ciphertext.
 *
 * Keys and credentials below are test-only fixtures — not real secrets.
 */
const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);
/** Wrong-format keys that pass decryptPII's ≥32-char gate but are not 32 bytes of hex. */
const KEY_BASE64_44 = `${'Q'.repeat(43)}=`; // shape of `openssl rand -base64 32`
const KEY_HEX_32 = 'c3'.repeat(16);
const SECRET = 'test-only-line-shop-channel-secret';
const TOKEN = 'test-only-line-shop-channel-token';

type Row = { key: string; value: string; label?: string | null; deletedAt: Date | null };

/** In-memory `system_config` — enough of the Prisma surface the service uses. */
function fakePrisma(initial: Record<string, string> = {}) {
  const rows = new Map<string, Row>();
  for (const [key, value] of Object.entries(initial)) {
    rows.set(key, { key, value, deletedAt: null });
  }
  const live = (row: Row | undefined) => (row && row.deletedAt === null ? row : null);
  return {
    rows,
    systemConfig: {
      findFirst: jest.fn(async ({ where }: { where: { key: string } }) =>
        live(rows.get(where.key)),
      ),
      findMany: jest.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.map((key) => live(rows.get(key))).filter((row): row is Row => row !== null),
      ),
      upsert: jest.fn(
        async (args: {
          where: { key: string };
          create: { key: string; value: string; label?: string };
          update: { value: string; deletedAt: null };
        }) => {
          const current = rows.get(args.where.key);
          const next: Row = current
            ? { ...current, ...args.update }
            : { ...args.create, deletedAt: null };
          rows.set(args.where.key, next);
          return next;
        },
      ),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  };
}

/** A service instance (= one API process) holding `key`, reading/writing `prisma`. */
function serviceOn(prisma: ReturnType<typeof fakePrisma>, key: string | undefined) {
  const config = {
    get: jest.fn((name: string) => (name === 'INTEGRATION_ENCRYPTION_KEY' ? key : undefined)),
  } as unknown as ConfigService;
  return new IntegrationConfigService(prisma as never, config);
}

function build(key: string | undefined, initial: Record<string, string> = {}) {
  const prisma = fakePrisma(initial);
  return { prisma, service: serviceOn(prisma, key) };
}

const SECRET_KEY = 'integration.line-shop.channelSecret';
const TOKEN_KEY = 'integration.line-shop.channelToken';

/** Everything that left the process through Logger / Sentry, as one string. */
function emitted(...spies: jest.SpyInstance[]): string {
  const sentry = (Sentry.captureMessage as jest.Mock).mock.calls;
  return JSON.stringify([...spies.map((s) => s.mock.calls), sentry]);
}

describe('IntegrationConfigService.getValue — undecryptable credentials fail closed', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let log: jest.SpyInstance;
  const envBefore = process.env.LINE_CHANNEL_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    delete process.env.LINE_CHANNEL_SECRET;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (envBefore === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = envBefore;
  });

  it('wrong key → undefined (no throw), warning names only integrationKey.fieldKey', async () => {
    const ciphertext = encryptPII(SECRET, KEY_A);
    const { service } = build(KEY_B, { [SECRET_KEY]: ciphertext });

    await expect(service.getValue('line-shop', 'channelSecret')).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('line-shop.channelSecret');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const out = emitted(warn, error, log);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(ciphertext);
    expect(out).not.toContain(ciphertext.split(':')[2]);
  });

  it('wrong key → does NOT fall back to the env var for that field', async () => {
    process.env.LINE_CHANNEL_SECRET = 'test-only-env-fallback-secret';
    const { service } = build(KEY_B, { [SECRET_KEY]: encryptPII(SECRET, KEY_A) });

    await expect(service.getValue('line-shop', 'channelSecret')).resolves.toBeUndefined();
  });

  it('no key + encrypted DB value → undefined + warning, never the ciphertext', async () => {
    const ciphertext = encryptPII(SECRET, KEY_A);
    const { service } = build(undefined, { [SECRET_KEY]: ciphertext });

    await expect(service.getValue('line-shop', 'channelSecret')).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('line-shop.channelSecret');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(emitted(warn, error, log)).not.toContain(ciphertext);
  });

  it('malformed (too short) key → undefined, not the ciphertext decryptPII passes through', async () => {
    const ciphertext = encryptPII(SECRET, KEY_A);
    const { service } = build('too-short', { [SECRET_KEY]: ciphertext });

    await expect(service.getValue('line-shop', 'channelSecret')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('(key-invalid)');
  });

  it.each([
    ['base64 (44 chars)', KEY_BASE64_44],
    ['hex, 32 chars', KEY_HEX_32],
  ])(
    'malformed key (%s) reads an encrypted row as not configured — reason key-invalid',
    async (_, key) => {
      const { service } = build(key, { [SECRET_KEY]: encryptPII(SECRET, KEY_A) });

      await expect(service.getValue('line-shop', 'channelSecret')).resolves.toBeUndefined();
      expect(String(warn.mock.calls[0][0])).toContain('(key-invalid)');
    },
  );

  it('a well-formed key with surrounding whitespace / newline is trimmed and used', async () => {
    const { service } = build(`  ${KEY_A}\n`, { [SECRET_KEY]: encryptPII(SECRET, KEY_A) });

    await expect(service.getValue('line-shop', 'channelSecret')).resolves.toBe(SECRET);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['base64 (44 chars)', KEY_BASE64_44],
    ['hex, 32 chars', KEY_HEX_32],
  ])(
    'saveConfig with a malformed key (%s) does not 500 — stores like no key and reads back',
    async (_, key) => {
      const { service, prisma } = build(key);

      await expect(
        service.saveConfig('line-shop', { channelSecret: SECRET, liffId: 'test-liff-id' }),
      ).resolves.toBeUndefined();

      expect(prisma.rows.get(SECRET_KEY)?.value).toBe(SECRET);
      expect(prisma.rows.get('integration.line-shop.liffId')?.value).toBe('test-liff-id');
      await expect(service.getValue('line-shop', 'channelSecret')).resolves.toBe(SECRET);
    },
  );

  it('repeated reads of the same field warn once (hot paths: webhook guard, every send)', async () => {
    const { service } = build(KEY_B, { [SECRET_KEY]: encryptPII(SECRET, KEY_A) });

    await service.getValue('line-shop', 'channelSecret');
    await service.getValue('line-shop', 'channelSecret');
    await service.getValue('line-shop', 'channelSecret');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('admin views and status treat the field as not configured instead of throwing', async () => {
    const ciphertext = encryptPII(TOKEN, KEY_A);
    const { service } = build(KEY_B, {
      [TOKEN_KEY]: ciphertext,
      [SECRET_KEY]: encryptPII(SECRET, KEY_A),
      'integration.line-shop.liffId': 'test-liff-id',
    });

    const masked = await service.getMaskedConfig('line-shop');
    expect(masked.channelToken).toBe('');
    expect(masked.channelSecret).toBe('');
    expect(masked.liffId).toBe('test-liff-id');
    expect(JSON.stringify(masked)).not.toContain(ciphertext.slice(-4));

    const config = await service.getConfig('line-shop');
    expect(config.channelToken).toBe('');
    await expect(service.isConfigured('line-shop')).resolves.toBe(false);
  });
});

describe('IntegrationConfigService boot self-check (onModuleInit)', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const selfCheckLines = (spy: jest.SpyInstance) =>
    spy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('integration encrypted fields'));

  it('key matches → one line "key=ok ok=N failed=0", no Sentry', async () => {
    const { service } = build(KEY_A, {
      [TOKEN_KEY]: encryptPII(TOKEN, KEY_A),
      [SECRET_KEY]: encryptPII(SECRET, KEY_A),
      'integration.peak.userToken': 'test-only-plaintext-token',
    });

    await service.onModuleInit();

    expect(selfCheckLines(log)).toEqual([
      'integration encrypted fields: key=ok ok=2 [line-shop.channelSecret, line-shop.channelToken] failed=0 []',
    ]);
    expect(selfCheckLines(warn)).toEqual([]);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('wrong key → one warning line with failed keys only + Sentry warning without values', async () => {
    const tokenCipher = encryptPII(TOKEN, KEY_A);
    const secretCipher = encryptPII(SECRET, KEY_A);
    const { service } = build(KEY_B, { [TOKEN_KEY]: tokenCipher, [SECRET_KEY]: secretCipher });

    await service.onModuleInit();

    expect(selfCheckLines(warn)).toEqual([
      'integration encrypted fields: key=ok ok=0 [] failed=2 [line-shop.channelSecret, line-shop.channelToken]',
    ]);
    expect(selfCheckLines(log)).toEqual([]);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [, context] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(context).toMatchObject({
      level: 'warning',
      extra: { ok: 0, failed: ['line-shop.channelSecret', 'line-shop.channelToken'] },
    });
    const out = emitted(warn, error, log);
    for (const leaked of [TOKEN, SECRET, tokenCipher, secretCipher]) {
      expect(out).not.toContain(leaked);
    }
  });

  it('mixed → names both the fields that decrypt and the ones that do not', async () => {
    const { service } = build(KEY_A, {
      [SECRET_KEY]: encryptPII(SECRET, KEY_A),
      'integration.peak.secretKey': encryptPII('test-only-peak-secret', KEY_B),
    });

    await service.onModuleInit();

    expect(selfCheckLines(warn)).toEqual([
      'integration encrypted fields: key=ok ok=1 [line-shop.channelSecret] failed=1 [peak.secretKey]',
    ]);
  });

  it('no key + encrypted values → keeps the "key not set" warning and reports them failed', async () => {
    const { service } = build(undefined, { [SECRET_KEY]: encryptPII(SECRET, KEY_A) });

    await service.onModuleInit();

    expect(selfCheckLines(warn)).toEqual([
      'integration encrypted fields: key=missing ok=0 [] failed=1 [line-shop.channelSecret]',
    ]);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'INTEGRATION_ENCRYPTION_KEY not set',
    );
  });

  it('no key and nothing encrypted → no self-check line', async () => {
    const { service } = build(undefined, { [SECRET_KEY]: 'test-only-plaintext-secret' });

    await service.onModuleInit();

    expect(selfCheckLines(log)).toEqual([]);
    expect(selfCheckLines(warn)).toEqual([]);
  });

  it('key present but nothing encrypted → the line is still printed (absence is never ambiguous)', async () => {
    const { service } = build(KEY_A, { [SECRET_KEY]: 'test-only-plaintext-secret' });

    await service.onModuleInit();

    expect(selfCheckLines(log)).toEqual([
      'integration encrypted fields: key=ok ok=0 [] failed=0 []',
    ]);
  });

  it.each([
    ['base64 (44 chars)', KEY_BASE64_44],
    ['hex, 32 chars', KEY_HEX_32],
  ])(
    'malformed key (%s) → error + Sentry without value or length, boot continues, line says key=malformed',
    async (_, key) => {
      const { service } = build(key, { [SECRET_KEY]: encryptPII(SECRET, KEY_A) });

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      const errors = error.mock.calls.map((c) => String(c[0]));
      expect(
        errors.some((m) => m.includes('INTEGRATION_ENCRYPTION_KEY') && m.includes('malformed')),
      ).toBe(true);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'INTEGRATION_ENCRYPTION_KEY malformed (need 64 hex chars)',
        'error',
      );
      expect(selfCheckLines(warn)).toEqual([
        'integration encrypted fields: key=malformed ok=0 [] failed=1 [line-shop.channelSecret]',
      ]);
      const out = emitted(warn, error, log);
      expect(out).not.toContain(key);
      expect(out).not.toContain(String(key.length));
    },
  );

  it('malformed key and nothing encrypted → the line is still printed with key=malformed', async () => {
    const { service } = build(KEY_HEX_32);

    await service.onModuleInit();

    expect(selfCheckLines(warn)).toEqual([
      'integration encrypted fields: key=malformed ok=0 [] failed=0 []',
    ]);
  });

  it('a DB error during the check never blocks boot', async () => {
    const { service, prisma } = build(KEY_A);
    prisma.systemConfig.findMany.mockRejectedValueOnce(new Error('db down'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'integration encrypted fields: check failed',
    );
  });

  it('checkEncryptedFields(integrationKey) only looks at that integration', async () => {
    const { service } = build(KEY_B, {
      [SECRET_KEY]: encryptPII(SECRET, KEY_A),
      'integration.peak.secretKey': encryptPII('test-only-peak-secret', KEY_B),
    });

    await expect(service.checkEncryptedFields('peak')).resolves.toEqual({
      key: 'ok',
      ok: ['peak.secretKey'],
      failed: [],
    });
    await expect(service.checkEncryptedFields()).resolves.toEqual({
      key: 'ok',
      ok: ['peak.secretKey'],
      failed: ['line-shop.channelSecret'],
    });
  });
});

/**
 * Behaviour proof for the prod rollout: one `system_config`, written and read by
 * processes holding different keys (what happens when the deploy mounts a key
 * that may or may not be the one the stored credentials were encrypted with).
 */
describe('IntegrationConfigService — key × stored value matrix (round-trip through saveConfig)', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('key set + plaintext stored (saved before the key existed) → unchanged value', async () => {
    const prisma = fakePrisma();
    await serviceOn(prisma, undefined).saveConfig('line-shop', { channelSecret: SECRET });
    expect(prisma.rows.get(SECRET_KEY)?.value).toBe(SECRET);

    await expect(serviceOn(prisma, KEY_A).getValue('line-shop', 'channelSecret')).resolves.toBe(
      SECRET,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('saving a sensitive field with the key set → stored encrypted, reads back with the same key', async () => {
    const prisma = fakePrisma();
    await serviceOn(prisma, KEY_A).saveConfig('line-shop', {
      channelSecret: SECRET,
      liffId: 'test-liff-id',
    });

    const stored = prisma.rows.get(SECRET_KEY)?.value ?? '';
    expect(stored).not.toBe(SECRET);
    expect(stored).not.toContain(SECRET);
    expect(stored.split(':')).toHaveLength(3); // iv:authTag:ciphertext
    // Non-sensitive fields stay plaintext.
    expect(prisma.rows.get('integration.line-shop.liffId')?.value).toBe('test-liff-id');

    // A fresh process (no cache) with the same key decrypts it.
    await expect(serviceOn(prisma, KEY_A).getValue('line-shop', 'channelSecret')).resolves.toBe(
      SECRET,
    );
    await expect(serviceOn(prisma, KEY_A).checkEncryptedFields()).resolves.toEqual({
      key: 'ok',
      ok: ['line-shop.channelSecret'],
      failed: [],
    });
  });

  it('key set + encrypted with another key → undefined, no throw, value never logged', async () => {
    const prisma = fakePrisma();
    await serviceOn(prisma, KEY_A).saveConfig('line-shop', { channelSecret: SECRET });
    const stored = prisma.rows.get(SECRET_KEY)?.value ?? '';

    const other = serviceOn(prisma, KEY_B);
    await expect(other.getValue('line-shop', 'channelSecret')).resolves.toBeUndefined();
    await expect(other.getMaskedConfig('line-shop')).resolves.toMatchObject({ channelSecret: '' });
    await expect(other.checkEncryptedFields()).resolves.toEqual({
      key: 'ok',
      ok: [],
      failed: ['line-shop.channelSecret'],
    });

    const out = emitted(warn, error, log);
    expect(out).toContain('line-shop.channelSecret');
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(stored);
  });

  it('key unset + encrypted → undefined + warning', async () => {
    const prisma = fakePrisma();
    await serviceOn(prisma, KEY_A).saveConfig('line-shop', { channelSecret: SECRET });

    await expect(
      serviceOn(prisma, undefined).getValue('line-shop', 'channelSecret'),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('line-shop.channelSecret');
    expect(String(warn.mock.calls[0][0])).toContain('key-missing');
  });

  it('re-entering the credential under the new key heals the field', async () => {
    const prisma = fakePrisma();
    await serviceOn(prisma, KEY_A).saveConfig('line-shop', { channelSecret: SECRET });

    const current = serviceOn(prisma, KEY_B);
    await expect(current.getValue('line-shop', 'channelSecret')).resolves.toBeUndefined();
    await current.saveConfig('line-shop', { channelSecret: 'test-only-re-entered-secret' });

    await expect(serviceOn(prisma, KEY_B).getValue('line-shop', 'channelSecret')).resolves.toBe(
      'test-only-re-entered-secret',
    );
    await expect(serviceOn(prisma, KEY_B).checkEncryptedFields()).resolves.toEqual({
      key: 'ok',
      ok: ['line-shop.channelSecret'],
      failed: [],
    });
  });
});
