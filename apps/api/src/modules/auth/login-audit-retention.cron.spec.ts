import { Test, TestingModule } from '@nestjs/testing';
import { LoginAuditRetentionCron } from './login-audit-retention.cron';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('LoginAuditRetentionCron.purgeOldEntries', () => {
  let cron: LoginAuditRetentionCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    (Sentry.captureException as jest.Mock).mockClear();
    prisma = {
      loginAuditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [LoginAuditRetentionCron, { provide: PrismaService, useValue: prisma }],
    }).compile();
    cron = mod.get(LoginAuditRetentionCron);
  });

  it('uses 90d cutoff', async () => {
    await cron.purgeOldEntries();
    const where = prisma.loginAuditLog.deleteMany.mock.calls[0][0].where;
    const cutoff = where.createdAt.lt as Date;
    const ageMs = Date.now() - cutoff.getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(89.9);
    expect(ageDays).toBeLessThan(90.1);
  });

  it('returns deletion count', async () => {
    prisma.loginAuditLog.deleteMany.mockResolvedValue({ count: 17 });
    const result = await cron.purgeOldEntries();
    expect(result.deleted).toBe(17);
  });

  it('captures exception on DB failure (no throw)', async () => {
    prisma.loginAuditLog.deleteMany.mockRejectedValue(new Error('table locked'));
    const result = await cron.purgeOldEntries();
    expect(result.deleted).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
