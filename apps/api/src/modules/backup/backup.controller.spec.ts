import { Test, TestingModule } from '@nestjs/testing';
import { BackupController } from './backup.controller';
import { OffsiteBackupService } from './offsite-backup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('BackupController', () => {
  let controller: BackupController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;

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
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [BackupController],
      providers: [{ provide: OffsiteBackupService, useValue: service }],
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
    it('passes userId from CurrentUser to service.run as triggeredBy', async () => {
      service.run.mockResolvedValue({
        id: 'run-1',
        status: 'SUCCESS',
        filesCount: 3,
        totalBytes: 1024,
        durationMs: 1000,
        startedAt: new Date(),
        finishedAt: new Date(),
      });
      const res = await controller.triggerNow('user-uuid-123');
      expect(service.run).toHaveBeenCalledWith('user-uuid-123');
      expect(res.status).toBe('SUCCESS');
      expect(res.filesCount).toBe(3);
      expect(res.errorMessage).toBeNull();
    });

    it('falls back to "manual" when no user id present (e.g. service-account)', async () => {
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
      const res = await controller.triggerNow('');
      expect(service.run).toHaveBeenCalledWith('manual');
      expect(res.errorMessage).toBe('boom');
    });
  });

  describe('GET /backup/offsite-status', () => {
    it('returns enabled flag, config, and recent runs', async () => {
      service.getRecentRuns.mockResolvedValue([{ id: 'r1', status: 'SUCCESS' }]);
      const res = await controller.getStatus();
      expect(res.enabled).toBe(true);
      expect(res.destBucket).toBe('dest-bkt');
      expect(res.retentionDays).toBe(30);
      expect(res.sqlSourceBucket).toBe('sql-src');
      expect(res.runs).toHaveLength(1);
      expect(service.getRecentRuns).toHaveBeenCalledWith(7);
    });

    it('clamps limit to [1, 30]', async () => {
      await controller.getStatus('100');
      expect(service.getRecentRuns).toHaveBeenLastCalledWith(7); // out-of-range → default 7
      await controller.getStatus('15');
      expect(service.getRecentRuns).toHaveBeenLastCalledWith(15);
      await controller.getStatus('not-a-number');
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
