import { PdpaEncryptionController } from './pdpa-encryption.controller';
import type { PdpaEncryptionService } from './pdpa-encryption.service';
import type { AuditService } from '../audit/audit.service';
import type { Request } from 'express';

describe('PdpaEncryptionController', () => {
  let svc: jest.Mocked<PdpaEncryptionService>;
  let audit: jest.Mocked<AuditService>;
  let controller: PdpaEncryptionController;

  function makeReq(): Request {
    return {
      ip: '10.1.2.3',
      headers: { 'user-agent': 'Jest/1.0' },
    } as unknown as Request;
  }

  beforeEach(() => {
    svc = {
      getStatus: jest.fn(),
      setStrictMode: jest.fn(),
      runBackfill: jest.fn(),
      getRun: jest.fn(),
      getRecentRuns: jest.fn(),
    } as unknown as jest.Mocked<PdpaEncryptionService>;
    audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<AuditService>;
    controller = new PdpaEncryptionController(svc, audit);
  });

  describe('setStrictMode', () => {
    it('writes PDPA_STRICT_MODE_TOGGLED audit log with old/new value + ip + userAgent (W6)', async () => {
      svc.getStatus.mockResolvedValue({
        strictMode: false,
        totalCustomers: 10,
        encryptedCount: 10,
        plaintextCount: 0,
        plaintextByColumn: [],
        readyForStrictMode: true,
        encryptionKeyConfigured: true,
        hashSaltConfigured: true,
      });
      svc.setStrictMode.mockResolvedValue({ strictMode: true });

      const result = await controller.setStrictMode(
        { enabled: true },
        { id: 'u1', role: 'OWNER' },
        makeReq(),
      );
      expect(result).toEqual({ strictMode: true });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          action: 'PDPA_STRICT_MODE_TOGGLED',
          entity: 'system_config',
          entityId: 'PDPA_STRICT_MODE',
          ipAddress: '10.1.2.3',
          userAgent: 'Jest/1.0',
          oldValue: { strictMode: false },
          newValue: { strictMode: true },
        }),
      );
    });
  });

  describe('runBackfill', () => {
    it('delegates to service.runBackfill and forwards ip + userAgent (W7)', async () => {
      svc.runBackfill.mockResolvedValue({
        id: 'run-1',
        status: 'COMPLETED',
        totalRecords: 10,
        processedRecords: 10,
        skippedRecords: 0,
        durationMs: 1234,
      });
      const result = await controller.runBackfill({ id: 'u1', role: 'OWNER' }, makeReq());
      expect(result.id).toBe('run-1');
      expect(svc.runBackfill).toHaveBeenCalledWith(
        expect.objectContaining({
          triggeredBy: 'manual',
          triggeredByUserId: 'u1',
          ipAddress: '10.1.2.3',
          userAgent: 'Jest/1.0',
        }),
      );
      // Controller no longer writes its own audit log — the service does
      // (so the CLI path also gets one). Test confirms the controller is
      // NOT double-writing.
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('getRecentRuns', () => {
    it('caps limit at 30 and defaults to 7', async () => {
      svc.getRecentRuns.mockResolvedValue([]);
      await controller.getRecentRuns(undefined);
      expect(svc.getRecentRuns).toHaveBeenCalledWith(7);
      svc.getRecentRuns.mockClear();
      await controller.getRecentRuns('100');
      expect(svc.getRecentRuns).toHaveBeenCalledWith(7); // 100 > 30 → falls back to 7
      svc.getRecentRuns.mockClear();
      await controller.getRecentRuns('15');
      expect(svc.getRecentRuns).toHaveBeenCalledWith(15);
    });
  });
});
