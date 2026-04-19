import { Test } from '@nestjs/testing';
import { CredentialRotationCron } from './credential-rotation.cron';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('CredentialRotationCron (T6-C9)', () => {
  let cron: CredentialRotationCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const envBackup = process.env.INTEGRATION_ROTATION_THRESHOLD_DAYS;

  beforeEach(async () => {
    process.env.INTEGRATION_ROTATION_THRESHOLD_DAYS = '90';
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();
    prisma = {
      systemConfig: {
        findFirst: jest.fn(),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [CredentialRotationCron, { provide: PrismaService, useValue: prisma }],
    }).compile();
    cron = mod.get(CredentialRotationCron);
  });

  afterEach(() => {
    process.env.INTEGRATION_ROTATION_THRESHOLD_DAYS = envBackup;
  });

  it('skips fields with no SystemConfig row (never configured)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue(null);
    const result = await cron.checkStale();
    expect(result.stale).toBe(0);
    expect(result.ok).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('counts recently-updated credentials as OK (< 90 days)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({
      value: 'encrypted-value',
      updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    const result = await cron.checkStale();
    expect(result.stale).toBe(0);
    expect(result.ok).toBeGreaterThan(0);
  });

  it('flags stale credentials (> 90 days) and emits Sentry warning', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({
      value: 'encrypted-value',
      updatedAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
    });
    const result = await cron.checkStale();
    expect(result.stale).toBeGreaterThan(0);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('stale'),
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('uses env threshold when INTEGRATION_ROTATION_THRESHOLD_DAYS is set', async () => {
    process.env.INTEGRATION_ROTATION_THRESHOLD_DAYS = '7';
    // Re-create cron so constructor re-reads env
    const mod = await Test.createTestingModule({
      providers: [CredentialRotationCron, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const cron7d = mod.get(CredentialRotationCron);

    prisma.systemConfig.findFirst.mockResolvedValue({
      value: 'encrypted-value',
      updatedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    });
    const result = await cron7d.checkStale();
    expect(result.stale).toBeGreaterThan(0);
  });

  it('falls back to 90 days when env value is invalid', async () => {
    process.env.INTEGRATION_ROTATION_THRESHOLD_DAYS = 'abc';
    const mod = await Test.createTestingModule({
      providers: [CredentialRotationCron, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const cronFallback = mod.get(CredentialRotationCron);

    prisma.systemConfig.findFirst.mockResolvedValue({
      value: 'x',
      updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    });
    const result = await cronFallback.checkStale();
    expect(result.stale).toBe(0);
  });

  it('swallows DB exception + Sentry.captureException (cron never throws)', async () => {
    prisma.systemConfig.findFirst.mockRejectedValue(new Error('db down'));
    const result = await cron.checkStale();
    expect(result).toEqual({ stale: 0, ok: 0, skipped: 0 });
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('ignores non-sensitive fields (only iterates sensitive ones)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({
      value: 'x',
      updatedAt: new Date(),
    });
    await cron.checkStale();
    // Every findFirst call's key must include a sensitive field name
    const keys = prisma.systemConfig.findFirst.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0].where.key,
    );
    expect(keys.length).toBeGreaterThan(0);
    // Non-sensitive keys like liff-id should not be queried
    expect(keys.every((k: string) => !k.endsWith('.liffId'))).toBe(true);
  });
});
