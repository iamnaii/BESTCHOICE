import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { CLEARED_CREDENTIAL, IntegrationConfigService } from '../integration-config.service';

jest.mock('@sentry/node', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

/**
 * Task 32 — "ล้างค่า" on real Postgres: the cleared marker (multi-byte `•`) round-trips
 * through `system_config.value` exactly, a cleared field reads `undefined` while the env
 * var is set, the boot self-check skips it, and a new save brings the field back.
 *
 * รัน: DATABASE_URL=<ฐานทดสอบ test_db หรือ *_test> npx jest <ไฟล์นี้> --runInBand · ไม่มี DATABASE_URL = ข้าม
 * Writes `integration.line-finance.channelToken` and restores the row it found at the end.
 * Keys, tokens and env values are test-only fixtures — not real secrets.
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const KEY_A = 'a1'.repeat(32);
const ROW_KEY = 'integration.line-finance.channelToken';
const ENV_VAR = 'LINE_FINANCE_CHANNEL_ACCESS_TOKEN';
const TOKEN = 'test-only-db-finance-channel-token';
const NEW_TOKEN = 'test-only-db-new-finance-channel-token';

describeDb('IntegrationConfigService.clearSecret (real DB)', () => {
  const prisma = new PrismaClient();
  const config = {
    get: jest.fn((name: string) => (name === 'INTEGRATION_ENCRYPTION_KEY' ? KEY_A : undefined)),
  } as unknown as ConfigService;
  const service = new IntegrationConfigService(prisma as never, config);
  const envBefore = process.env[ENV_VAR];
  let rowBefore: { value: string; label: string | null; deletedAt: Date | null } | null = null;

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
    if (!/^test_db$|_test$/.test(dbName)) {
      throw new Error(
        `สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ (test_db หรือ *_test) แต่ได้ "${dbName}"`,
      );
    }
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    rowBefore = await prisma.systemConfig.findUnique({
      where: { key: ROW_KEY },
      select: { value: true, label: true, deletedAt: true },
    });
    process.env[ENV_VAR] = 'test-only-db-env-finance-channel-token';
  });

  afterAll(async () => {
    if (rowBefore) {
      await prisma.systemConfig.update({ where: { key: ROW_KEY }, data: rowBefore });
    } else {
      await prisma.systemConfig.deleteMany({ where: { key: ROW_KEY } });
    }
    if (envBefore === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = envBefore;
    jest.restoreAllMocks();
    await prisma.$disconnect();
  });

  it('save → clear → reads undefined with the env var set → save again works', async () => {
    await service.saveConfig('line-finance', { channelToken: TOKEN });
    await expect(service.getValue('line-finance', 'channelToken')).resolves.toBe(TOKEN);

    await expect(service.clearSecret('line-finance', 'channelToken')).resolves.toEqual({
      previousSource: 'database',
    });

    const stored = await prisma.systemConfig.findUnique({ where: { key: ROW_KEY } });
    expect(stored?.value).toBe(CLEARED_CREDENTIAL);
    expect(stored?.deletedAt).toBeNull();
    await expect(service.getValue('line-finance', 'channelToken')).resolves.toBeUndefined();
    await expect(service.isConfigured('line-finance')).resolves.toBe(false);
    const check = await service.checkEncryptedFields('line-finance');
    expect([...check.ok, ...check.failed]).not.toContain('line-finance.channelToken');

    await service.saveConfig('line-finance', { channelToken: NEW_TOKEN });
    await expect(service.getValue('line-finance', 'channelToken')).resolves.toBe(NEW_TOKEN);
  });
});
