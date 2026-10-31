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

function build(key: string | undefined, initial: Record<string, string> = {}) {
  const prisma = fakePrisma(initial);
  const config = {
    get: jest.fn((name: string) => (name === 'INTEGRATION_ENCRYPTION_KEY' ? key : undefined)),
  } as unknown as ConfigService;
  return { prisma, service: new IntegrationConfigService(prisma as never, config) };
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
  });

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
