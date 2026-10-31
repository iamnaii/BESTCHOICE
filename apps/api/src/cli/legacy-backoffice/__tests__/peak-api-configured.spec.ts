import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { encryptPII } from '../../../utils/crypto.util';
import {
  defaultPeakApiConfigured,
  defaultPeakEncryptedFields,
  peakApiRefusalFor,
} from '../legacy-backoffice-import.cli';

/**
 * The import refuses to write while the PEAK API is configured (legacy journals
 * would be pushed to PEAK = revenue booked twice). Since Task 26 `getValue`
 * reads an undecryptable credential as "not configured" — this guard must still
 * count a PEAK credential that is stored but unreadable by the CLI as
 * configured: the API holding the right key could still push to PEAK.
 *
 * Keys and credentials are test-only fixtures.
 */
const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);
const ENV_NAMES = [
  'INTEGRATION_ENCRYPTION_KEY',
  'PEAK_USER_TOKEN',
  'PEAK_CONNECT_ID',
  'PEAK_SECRET_KEY',
] as const;

function prismaWith(rows: Record<string, string>): PrismaClient {
  const live = (key: string) => (key in rows ? { key, value: rows[key] } : null);
  return {
    systemConfig: {
      findFirst: jest.fn(async ({ where }: { where: { key: string } }) => live(where.key)),
      findMany: jest.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.map(live).filter((row) => row !== null),
      ),
    },
  } as unknown as PrismaClient;
}

function peakRows(key: string): Record<string, string> {
  return {
    'integration.peak.userToken': encryptPII('test-only-user-token', key),
    'integration.peak.connectId': 'test-only-connect-id',
    'integration.peak.secretKey': encryptPII('test-only-secret-key', key),
  };
}

describe('defaultPeakApiConfigured — undecryptable PEAK credentials still count as configured', () => {
  const saved: Partial<Record<(typeof ENV_NAMES)[number], string>> = {};

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    for (const name of ENV_NAMES) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const name of ENV_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('CLI without INTEGRATION_ENCRYPTION_KEY → configured (refuses the write)', async () => {
    await expect(defaultPeakApiConfigured(prismaWith(peakRows(KEY_A)))).resolves.toBe(true);
  });

  it('CLI with a different key → configured, no throw', async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = KEY_B;
    await expect(defaultPeakApiConfigured(prismaWith(peakRows(KEY_A)))).resolves.toBe(true);
  });

  it('CLI with the same key → configured (decrypted normally)', async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = KEY_A;
    await expect(defaultPeakApiConfigured(prismaWith(peakRows(KEY_A)))).resolves.toBe(true);
  });

  it('nothing stored and no PEAK_* env → not configured', async () => {
    await expect(defaultPeakApiConfigured(prismaWith({}))).resolves.toBe(false);
  });
});

/**
 * Review M-5: when the refusal comes from PEAK credentials the CLI cannot
 * decrypt, the message must name them and send the operator to the real fix
 * (same INTEGRATION_ENCRYPTION_KEY as the API) — not to a hub "clear" action
 * that does not exist. Since P-2 the hub also cannot clear User Token /
 * Secret Key (empty sensitive input = unchanged); Connect ID still clears.
 */
describe('peakApiRefusalFor — the refusal names what to do', () => {
  const deps = (configured: boolean, failed: string[], key: 'ok' | 'missing' | 'malformed') => ({
    peakApiConfigured: jest.fn(async () => configured),
    peakEncryptedFields: jest.fn(async () => ({ key, ok: [], failed })),
  });

  it('not configured → no refusal', async () => {
    await expect(peakApiRefusalFor(deps(false, [], 'ok'))).resolves.toBeNull();
  });

  it('configured and readable → disable PEAK first, pointing at Connect ID only', async () => {
    const message = await peakApiRefusalFor(deps(true, [], 'ok'));
    expect(message).toContain('ปิดการส่ง PEAK ทาง API ก่อน');
    expect(message).toContain('Connect ID');
    expect(message).toContain('ตั้งค่า › เชื่อมต่อ › การเชื่อมต่อ');
    expect(message).not.toContain('User Token / Connect ID / Secret Key');
  });

  it('configured and readable → explains the blank-looking form and how to confirm (re-review N-1)', async () => {
    const message = await peakApiRefusalFor(deps(true, [], 'ok'));
    // The hub form does not prefill non-secret fields: saving the blank-looking box sends nothing.
    expect(message).toContain('การ์ด "PEAK (บัญชี)"');
    expect(message).toContain('ฟอร์มไม่แสดงค่าที่ตั้งไว้');
    expect(message).toContain('พิมพ์อักษรใดก็ได้แล้วลบออก');
    // Exact badge text on the card (IntegrationHubPage IntegrationCard).
    expect(message).toContain('"ยังไม่ตั้งค่า"');
  });

  it('reading the encrypted-field hint fails → still refuses, with the configured message', async () => {
    const message = await peakApiRefusalFor({
      peakApiConfigured: async () => true,
      peakEncryptedFields: async () => {
        throw new Error('test-only: db down');
      },
    });
    expect(message).toContain('ปิดการส่ง PEAK ทาง API ก่อน');
  });

  it('no peakEncryptedFields dep (tests / older callers) → the configured message', async () => {
    const message = await peakApiRefusalFor({ peakApiConfigured: async () => true });
    expect(message).toContain('ปิดการส่ง PEAK ทาง API ก่อน');
  });

  it.each([
    ['missing', 'ไม่มี INTEGRATION_ENCRYPTION_KEY'],
    ['ok', 'ไม่ตรงกับ key ที่ใช้เข้ารหัส'],
    ['malformed', 'hex 64 ตัว'],
  ] as const)(
    'undecryptable (CLI key %s) → names the fields and the key fix, no hub "clear"',
    async (key, hint) => {
      const message = await peakApiRefusalFor(
        deps(true, ['peak.secretKey', 'peak.userToken'], key),
      );
      expect(message).toContain('peak.secretKey, peak.userToken');
      expect(message).toContain(hint);
      expect(message).toContain('INTEGRATION_ENCRYPTION_KEY ตัวเดียวกับ API');
      expect(message).toContain('.github/workflows/deploy-gcp.yml');
      expect(message).toContain('docs/runbooks/2026-10-31-integration-encryption-key.md');
      expect(message).not.toContain('ล้าง');
    },
  );

  it('defaultPeakEncryptedFields reads the PEAK fields the CLI cannot decrypt (names only)', async () => {
    const before = process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    try {
      await expect(defaultPeakEncryptedFields(prismaWith(peakRows(KEY_A)))).resolves.toEqual({
        key: 'missing',
        ok: [],
        failed: ['peak.secretKey', 'peak.userToken'],
      });
    } finally {
      if (before !== undefined) process.env.INTEGRATION_ENCRYPTION_KEY = before;
    }
  });
});
