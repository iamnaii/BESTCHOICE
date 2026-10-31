import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { encryptPII } from '../../../utils/crypto.util';
import { defaultPeakApiConfigured } from '../legacy-backoffice-import.cli';

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
