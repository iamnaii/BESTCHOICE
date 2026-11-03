import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { encryptPII, isEncrypted } from '../../utils/crypto.util';
import type { AuditService } from '../audit/audit.service';
import { CLEARED_CREDENTIAL, IntegrationConfigService } from './integration-config.service';
import { IntegrationsService } from './integrations.service';

jest.mock('@sentry/node', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));
// AuditService pulls in @sentry/nestjs, which needs the real @sentry/node mocked away above.
jest.mock('../audit/audit.service', () => ({ AuditService: class AuditService {} }));

/**
 * Task 32 — "ล้างค่า" a stored secret in Integration Hub.
 *
 * A cleared sensitive field must resolve to "not configured" everywhere that reads
 * through the Hub (getValue / getConfig / masked view / isConfigured / test buttons)
 * with NO env/default fallback — prod sets LINE_* from Secret Manager, so a plain
 * empty row would silently keep the old credential working. Saving a new non-empty
 * value replaces the cleared state.
 *
 * Keys, tokens and env values below are test-only fixtures — not real secrets.
 */
const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);
const TOKEN = 'test-only-finance-channel-token';
const ENV_TOKEN = 'test-only-env-finance-channel-token';
const NEW_TOKEN = 'test-only-new-finance-channel-token';
const TOKEN_KEY = 'integration.line-finance.channelToken';
const SECRET_KEY = 'integration.line-finance.channelSecret';
const ENV_VAR = 'LINE_FINANCE_CHANNEL_ACCESS_TOKEN';

type Row = { key: string; value: string; label?: string | null; deletedAt: Date | null };

/** In-memory `system_config` — the Prisma surface IntegrationConfigService uses. */
function fakePrisma(initial: Record<string, string> = {}) {
  const rows = new Map<string, Row>();
  for (const [key, value] of Object.entries(initial))
    rows.set(key, { key, value, deletedAt: null });
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

describe('IntegrationConfigService.clearSecret — cleared = not configured, no env fallback', () => {
  const envBefore = process.env[ENV_VAR];

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    process.env[ENV_VAR] = ENV_TOKEN;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (envBefore === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = envBefore;
  });

  it('control: without a row the env var is still the fallback (unchanged behaviour)', async () => {
    const { service } = build(KEY_A);
    await expect(service.getValue('line-finance', 'channelToken')).resolves.toBe(ENV_TOKEN);
  });

  it('a cleared field reads undefined even though the env var is set', async () => {
    const { service } = build(KEY_A, { [TOKEN_KEY]: encryptPII(TOKEN, KEY_A) });

    await service.clearSecret('line-finance', 'channelToken');

    await expect(service.getValue('line-finance', 'channelToken')).resolves.toBeUndefined();
  });

  it('getConfig / masked view show it as empty, isConfigured is false', async () => {
    const { service } = build(KEY_A, {
      [TOKEN_KEY]: encryptPII(TOKEN, KEY_A),
      [SECRET_KEY]: encryptPII('test-only-finance-secret', KEY_A),
    });
    await expect(service.isConfigured('line-finance')).resolves.toBe(true);

    await service.clearSecret('line-finance', 'channelToken');

    expect((await service.getConfig('line-finance')).channelToken).toBe('');
    expect((await service.getMaskedConfig('line-finance')).channelToken).toBe('');
    await expect(service.isConfigured('line-finance')).resolves.toBe(false);
  });

  it('drops the getConfig cache of this instance (a cached value must not survive the clear)', async () => {
    const { service } = build(KEY_A, { [TOKEN_KEY]: encryptPII(TOKEN, KEY_A) });
    expect((await service.getConfig('line-finance')).channelToken).toBe(TOKEN); // now cached

    await service.clearSecret('line-finance', 'channelToken');

    expect((await service.getConfig('line-finance')).channelToken).toBe('');
  });

  it('stores a non-encrypted marker — never the old value, never ciphertext', async () => {
    const { service, prisma } = build(KEY_A, { [TOKEN_KEY]: encryptPII(TOKEN, KEY_A) });

    await service.clearSecret('line-finance', 'channelToken');

    const stored = prisma.rows.get(TOKEN_KEY)!;
    expect(stored.value).toBe(CLEARED_CREDENTIAL);
    expect(stored.deletedAt).toBeNull();
    expect(isEncrypted(stored.value)).toBe(false);
    expect(JSON.stringify([...prisma.rows.values()])).not.toContain(TOKEN);
  });

  it('a field cleared while only the env var supplied it stays cleared (env no longer used)', async () => {
    const { service, prisma } = build(KEY_A);

    await expect(service.clearSecret('line-finance', 'channelToken')).resolves.toEqual({
      previousSource: 'env',
    });

    expect(prisma.rows.get(TOKEN_KEY)?.value).toBe(CLEARED_CREDENTIAL);
    await expect(service.getValue('line-finance', 'channelToken')).resolves.toBeUndefined();
  });

  it('reports where the value came from before — database / env / none (never the value)', async () => {
    const stored = build(KEY_A, { [TOKEN_KEY]: encryptPII(TOKEN, KEY_A) });
    await expect(stored.service.clearSecret('line-finance', 'channelToken')).resolves.toEqual({
      previousSource: 'database',
    });
    await expect(stored.service.clearSecret('line-finance', 'channelToken')).resolves.toEqual({
      previousSource: 'cleared',
    });

    delete process.env[ENV_VAR];
    const none = build(KEY_A);
    await expect(none.service.clearSecret('line-finance', 'channelToken')).resolves.toEqual({
      previousSource: 'none',
    });
  });

  it('saving a new non-empty value replaces the cleared state', async () => {
    const { service } = build(KEY_A, { [TOKEN_KEY]: encryptPII(TOKEN, KEY_A) });
    await service.clearSecret('line-finance', 'channelToken');

    await service.saveConfig('line-finance', { channelToken: NEW_TOKEN });

    await expect(service.getValue('line-finance', 'channelToken')).resolves.toBe(NEW_TOKEN);
  });

  it('an empty or masked secret on save does not undo the clear', async () => {
    const { service, prisma } = build(KEY_A, { [TOKEN_KEY]: encryptPII(TOKEN, KEY_A) });
    await service.clearSecret('line-finance', 'channelToken');

    await service.saveConfig('line-finance', { channelToken: '' });
    await service.saveConfig('line-finance', { channelToken: '••••oken' });
    await service.saveConfig('line-finance', { channelToken: CLEARED_CREDENTIAL });

    expect(prisma.rows.get(TOKEN_KEY)?.value).toBe(CLEARED_CREDENTIAL);
    await expect(service.getValue('line-finance', 'channelToken')).resolves.toBeUndefined();
  });

  it('boot self-check lists a cleared field neither as decryptable nor as failed', async () => {
    // Stored under another key = "failed" before the clear; clearing resolves it.
    const { service } = build(KEY_B, {
      [TOKEN_KEY]: encryptPII(TOKEN, KEY_A),
      [SECRET_KEY]: encryptPII('test-only-finance-secret', KEY_B),
    });
    expect(await service.checkEncryptedFields('line-finance')).toEqual({
      key: 'ok',
      ok: ['line-finance.channelSecret'],
      failed: ['line-finance.channelToken'],
    });

    await service.clearSecret('line-finance', 'channelToken');

    expect(await service.checkEncryptedFields('line-finance')).toEqual({
      key: 'ok',
      ok: ['line-finance.channelSecret'],
      failed: [],
    });
  });

  it('refuses a non-sensitive field — those keep the existing "empty then save" behaviour', async () => {
    const { service, prisma } = build(KEY_A, { 'integration.line-finance.liffId': 'test-liff' });

    await expect(service.clearSecret('line-finance', 'liffId')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
    expect(prisma.rows.get('integration.line-finance.liffId')?.value).toBe('test-liff');
  });

  it('a non-sensitive field whose text equals the marker is just its value (no collision)', async () => {
    const { service } = build(KEY_A, { 'integration.line-finance.liffId': CLEARED_CREDENTIAL });
    await expect(service.getValue('line-finance', 'liffId')).resolves.toBe(CLEARED_CREDENTIAL);
  });

  it('unknown integration / field → 404', async () => {
    const { service } = build(KEY_A);
    await expect(service.clearSecret('no-such', 'channelToken')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.clearSecret('line-finance', 'noSuchField')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('IntegrationsService — test button + audit after "ล้างค่า"', () => {
  const envBefore = process.env[ENV_VAR];

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    process.env[ENV_VAR] = ENV_TOKEN;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (envBefore === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = envBefore;
  });

  function hub(initial: Record<string, string>) {
    const { service: config, prisma } = build(KEY_A, initial);
    const audit = { log: jest.fn(async () => undefined) };
    return {
      prisma,
      audit,
      service: new IntegrationsService(config, audit as unknown as AuditService),
    };
  }

  it('"ทดสอบการเชื่อมต่อ" reports not configured — it does not test with the env token', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('no network in tests'));
    const { service } = hub({ [TOKEN_KEY]: encryptPII(TOKEN, KEY_A) });

    await service.clearSecret('line-finance', 'channelToken', 'owner-1');
    const result = await service.testConnection('line-finance');

    expect(result.success).toBe(false);
    expect(result.message).toBe('ยังไม่ได้ตั้งค่า Channel Access Token ของ ไลน์การเงิน (FINANCE)');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the hub card turns "not configured"', async () => {
    const { service } = hub({
      [TOKEN_KEY]: encryptPII(TOKEN, KEY_A),
      [SECRET_KEY]: encryptPII('test-only-finance-secret', KEY_A),
    });
    const before = (await service.listAll()).find((i) => i.key === 'line-finance');
    expect(before?.status).toBe('connected');

    await service.clearSecret('line-finance', 'channelToken', 'owner-1');

    const after = (await service.listAll()).find((i) => i.key === 'line-finance');
    expect(after?.status).toBe('not_configured');
  });

  it('writes one audit row naming the field — without the value, the env value or ciphertext', async () => {
    const ciphertext = encryptPII(TOKEN, KEY_A);
    const { service, audit } = hub({ [TOKEN_KEY]: ciphertext });

    await expect(service.clearSecret('line-finance', 'channelToken', 'owner-1')).resolves.toEqual({
      cleared: true,
    });

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith({
      userId: 'owner-1',
      action: 'INTEGRATION_SECRET_CLEARED',
      entity: 'integrations',
      entityId: 'line-finance.channelToken',
      newValue: {
        integrationKey: 'line-finance',
        fieldKey: 'channelToken',
        previousSource: 'database',
      },
    });
    const out = JSON.stringify(audit.log.mock.calls);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(ENV_TOKEN);
    expect(out).not.toContain(ciphertext);
  });

  it('a refused clear (non-sensitive field) writes no audit row', async () => {
    const { service, audit } = hub({});
    await expect(service.clearSecret('line-finance', 'liffId', 'owner-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(audit.log).not.toHaveBeenCalled();
  });
});
