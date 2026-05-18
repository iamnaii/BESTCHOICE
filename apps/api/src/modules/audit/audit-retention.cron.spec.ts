import { Test, TestingModule } from '@nestjs/testing';
import { AuditRetentionCron } from './audit-retention.cron';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('AuditRetentionCron.archiveOldEntries', () => {
  let cron: AuditRetentionCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  const originalEnv = process.env.AUDIT_LOG_RETENTION_DAYS;

  beforeEach(async () => {
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
    prisma = {
      auditLog: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [AuditRetentionCron, { provide: PrismaService, useValue: prisma }],
    }).compile();
    cron = mod.get(AuditRetentionCron);
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AUDIT_LOG_RETENTION_DAYS;
    } else {
      process.env.AUDIT_LOG_RETENTION_DAYS = originalEnv;
    }
  });

  it('returns archived=0 when there are no old rows (and does not page Sentry)', async () => {
    prisma.auditLog.updateMany.mockResolvedValue({ count: 0 });
    const result = await cron.archiveOldEntries();
    expect(result.archived).toBe(0);
    expect(result.retentionDays).toBe(AuditRetentionCron.DEFAULT_RETENTION_DAYS);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('soft-archives rows older than retention (archivedAt set via updateMany, not delete)', async () => {
    prisma.auditLog.updateMany.mockResolvedValue({ count: 42 });
    const result = await cron.archiveOldEntries();
    expect(result.archived).toBe(42);

    // Verify we used UPDATE (not DELETE — the trigger would reject that).
    const call = prisma.auditLog.updateMany.mock.calls[0][0];
    expect(call.data.archivedAt).toBeInstanceOf(Date);
    expect(call.where.archivedAt).toBeNull();
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);

    // D1.4.3.1 — default raised to 1825d (5 yr per พ.ร.บ.บัญชี ม.7)
    const ageDays = (Date.now() - (call.where.createdAt.lt as Date).getTime()) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(1824.9);
    expect(ageDays).toBeLessThan(1825.1);

    // Sentry info when rows were actually archived
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('archived 42'),
      expect.objectContaining({ level: 'info' }),
    );
  });

  it('honours AUDIT_LOG_RETENTION_DAYS env override when SystemConfig absent', async () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = '30';
    prisma.auditLog.updateMany.mockResolvedValue({ count: 0 });
    const result = await cron.archiveOldEntries();
    expect(result.retentionDays).toBe(30);

    const where = prisma.auditLog.updateMany.mock.calls[0][0].where;
    const ageDays = (Date.now() - (where.createdAt.lt as Date).getTime()) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(29.9);
    expect(ageDays).toBeLessThan(30.1);
  });

  // D1.4.3.1 — SystemConfig override
  it('SystemConfig audit_log_retention_days takes precedence over env var', async () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = '30';
    prisma.systemConfig.findFirst.mockResolvedValue({ value: '900' });
    const result = await cron.archiveOldEntries();
    expect(result.retentionDays).toBe(900);
    const where = prisma.auditLog.updateMany.mock.calls[0][0].where;
    const ageDays = (Date.now() - (where.createdAt.lt as Date).getTime()) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(899.9);
    expect(ageDays).toBeLessThan(900.1);
  });

  it('falls through to default when SystemConfig + env are missing/invalid', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'not-a-number' });
    const result = await cron.archiveOldEntries();
    expect(result.retentionDays).toBe(AuditRetentionCron.DEFAULT_RETENTION_DAYS);
    expect(AuditRetentionCron.DEFAULT_RETENTION_DAYS).toBe(1825);
  });

  it('survives SystemConfig DB error (falls through to env/default)', async () => {
    prisma.systemConfig.findFirst.mockRejectedValue(new Error('db down'));
    const result = await cron.archiveOldEntries();
    expect(result.retentionDays).toBe(AuditRetentionCron.DEFAULT_RETENTION_DAYS);
  });

  // D1.4.3.2 — audit_log_archive_enabled toggle
  describe('D1.4.3.2 audit_log_archive_enabled toggle', () => {
    it('skips sweep entirely when audit_log_archive_enabled=false', async () => {
      prisma.systemConfig.findFirst.mockImplementation((args: { where: { key: string } }) =>
        Promise.resolve(
          args.where.key === 'audit_log_archive_enabled' ? { value: 'false' } : null,
        ),
      );
      const result = await cron.archiveOldEntries();
      expect(result.archived).toBe(0);
      expect(result.skipped).toBe(true);
      expect(prisma.auditLog.updateMany).not.toHaveBeenCalled();
    });

    it('runs sweep normally when audit_log_archive_enabled=true', async () => {
      prisma.systemConfig.findFirst.mockImplementation((args: { where: { key: string } }) =>
        Promise.resolve(
          args.where.key === 'audit_log_archive_enabled' ? { value: 'true' } : null,
        ),
      );
      prisma.auditLog.updateMany.mockResolvedValue({ count: 5 });
      const result = await cron.archiveOldEntries();
      expect(result.archived).toBe(5);
      expect(result.skipped).toBeUndefined();
      expect(prisma.auditLog.updateMany).toHaveBeenCalled();
    });

    it('defaults to enabled when toggle row absent (existing behaviour preserved)', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue(null);
      prisma.auditLog.updateMany.mockResolvedValue({ count: 3 });
      const result = await cron.archiveOldEntries();
      expect(result.archived).toBe(3);
      expect(result.skipped).toBeUndefined();
      expect(prisma.auditLog.updateMany).toHaveBeenCalled();
    });

    it('treats malformed toggle value as enabled (fail-safe default-on)', async () => {
      prisma.systemConfig.findFirst.mockImplementation((args: { where: { key: string } }) =>
        Promise.resolve(
          args.where.key === 'audit_log_archive_enabled' ? { value: 'maybe' } : null,
        ),
      );
      prisma.auditLog.updateMany.mockResolvedValue({ count: 1 });
      const result = await cron.archiveOldEntries();
      expect(result.skipped).toBeUndefined();
      expect(prisma.auditLog.updateMany).toHaveBeenCalled();
    });
  });
});
