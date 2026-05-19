import { Test, TestingModule } from '@nestjs/testing';
import { BackupController } from './backup.controller';
import { OffsiteBackupService } from './offsite-backup.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('BackupController', () => {
  let controller: BackupController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;

  const ownerUser = { id: 'owner-id', role: 'OWNER' };
  const accountantUser = { id: 'acc-id', role: 'ACCOUNTANT' };

  beforeEach(async () => {
    service = {
      run: jest.fn(),
      isEnabled: jest.fn().mockResolvedValue(true),
      setEnabled: jest.fn(),
      getRecentRuns: jest.fn().mockResolvedValue([]),
      getDestBucket: jest.fn().mockReturnValue('dest-bkt'),
      getRetentionDays: jest.fn().mockReturnValue(30),
      getSqlSourceBucket: jest.fn().mockReturnValue('sql-src'),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [BackupController],
      providers: [
        { provide: OffsiteBackupService, useValue: service },
        { provide: AuditService, useValue: audit },
      ],
    })
      // Bypass guards — JwtAuthGuard + RolesGuard wiring is validated by
      // unit tests for those guards; we only care about controller logic here.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(BackupController);
  });

  describe('POST /backup/offsite-now', () => {
    it('forwards manual + userId to service.run + writes AuditLog (C2)', async () => {
      service.run.mockResolvedValue({
        id: 'run-1',
        status: 'SUCCESS',
        filesCount: 3,
        totalBytes: 1024,
        durationMs: 1000,
        startedAt: new Date(),
        finishedAt: new Date(),
      });
      const res = await controller.triggerNow(ownerUser);
      expect(service.run).toHaveBeenCalledWith({
        triggeredBy: 'manual',
        triggeredByUserId: 'owner-id',
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'owner-id',
          action: 'OFFSITE_BACKUP_RUN_NOW',
          entity: 'offsite_backup',
          entityId: 'run-1',
        }),
      );
      expect(res.status).toBe('SUCCESS');
      expect(res.filesCount).toBe(3);
      expect(res.errorMessage).toBeNull();
    });

    it('handles failed runs and surfaces errorMessage', async () => {
      service.run.mockResolvedValue({
        id: 'run-2',
        status: 'FAILED',
        filesCount: 0,
        totalBytes: 0,
        durationMs: 50,
        startedAt: new Date(),
        finishedAt: new Date(),
        errorMessage: 'boom',
      });
      const res = await controller.triggerNow(ownerUser);
      expect(res.errorMessage).toBe('boom');
    });
  });

  describe('GET /backup/offsite-status', () => {
    it('returns full bucket names + run dest bucket for OWNER', async () => {
      service.getRecentRuns.mockResolvedValue([
        { id: 'r1', status: 'SUCCESS', destBucket: 'dest-bkt' },
      ]);
      const res = await controller.getStatus(ownerUser);
      expect(res.enabled).toBe(true);
      expect(res.destBucket).toBe('dest-bkt');
      expect(res.sqlSourceBucket).toBe('sql-src');
      expect(res.retentionDays).toBe(30);
      expect(res.runs[0].destBucket).toBe('dest-bkt');
      expect(service.getRecentRuns).toHaveBeenCalledWith(7);
    });

    it('strips bucket names from response when caller is not OWNER (W7)', async () => {
      service.getRecentRuns.mockResolvedValue([
        { id: 'r1', status: 'SUCCESS', destBucket: 'dest-bkt' },
      ]);
      const res = await controller.getStatus(accountantUser);
      expect(res.enabled).toBe(true);
      expect(res.destBucket).toBeNull();
      expect(res.sqlSourceBucket).toBeNull();
      // retentionDays is policy not infra — non-sensitive
      expect(res.retentionDays).toBe(30);
      expect(res.runs[0].destBucket).toBeNull();
    });

    it('clamps limit to [1, 30]', async () => {
      await controller.getStatus(ownerUser, '100');
      expect(service.getRecentRuns).toHaveBeenLastCalledWith(7); // out-of-range → default 7
      await controller.getStatus(ownerUser, '15');
      expect(service.getRecentRuns).toHaveBeenLastCalledWith(15);
      await controller.getStatus(ownerUser, 'not-a-number');
      expect(service.getRecentRuns).toHaveBeenLastCalledWith(7);
    });
  });

  describe('PUT /backup/offsite-enabled', () => {
    it('forwards boolean to service.setEnabled', async () => {
      service.setEnabled.mockResolvedValue(true);
      const res = await controller.setEnabled({ enabled: true });
      expect(res.enabled).toBe(true);
      expect(service.setEnabled).toHaveBeenCalledWith(true);
    });
  });
});
