import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VoiceMemoRestoreService } from './voice-memo-restore.service';
import { StorageService } from './storage.service';

describe('VoiceMemoRestoreService — P3 Task 3 Glacier real', () => {
  let service: VoiceMemoRestoreService;
  let mockPrisma: any;
  let mockStorage: any;

  beforeEach(async () => {
    mockPrisma = {
      callLog: {
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      notificationLog: {
        create: jest.fn(),
      },
    };
    mockStorage = {
      requestGlacierRestore: jest.fn(),
      isRestoreComplete: jest.fn(),
      restoreToStandardClass: jest.fn(),
      backend: 's3',
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceMemoRestoreService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    service = mod.get(VoiceMemoRestoreService);
  });

  describe('requestRestore', () => {
    it('throws NotFoundException when call log does not exist', async () => {
      mockPrisma.callLog.findFirst.mockResolvedValue(null);
      await expect(service.requestRestore('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when call log has no voice memo', async () => {
      mockPrisma.callLog.findFirst.mockResolvedValue({
        id: 'cl-1',
        voiceMemoUrl: null,
      });
      await expect(service.requestRestore('cl-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns immediately when memo is already HOT (no Glacier call)', async () => {
      mockPrisma.callLog.findFirst.mockResolvedValue({
        id: 'cl-1',
        voiceMemoUrl: 'voice-memos/cl-1.mp3',
        voiceMemoTier: 'HOT',
      });
      const res = await service.requestRestore('cl-1', 'user-1');
      expect(res.status).toBe('ALREADY_HOT');
      expect(mockStorage.requestGlacierRestore).not.toHaveBeenCalled();
      expect(mockStorage.restoreToStandardClass).not.toHaveBeenCalled();
    });

    it('S3 backend → calls requestGlacierRestore + flips tier RESTORE_IN_PROGRESS', async () => {
      mockStorage.backend = 's3';
      mockPrisma.callLog.findFirst.mockResolvedValue({
        id: 'cl-1',
        voiceMemoUrl: 'voice-memos/cl-1.mp3',
        voiceMemoTier: 'GLACIER',
      });
      mockStorage.requestGlacierRestore.mockResolvedValue({ ok: true });

      const res = await service.requestRestore('cl-1', 'user-1');
      expect(mockStorage.requestGlacierRestore).toHaveBeenCalledWith(
        'voice-memos/cl-1.mp3',
        7,
      );
      expect(mockPrisma.callLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cl-1' },
          data: expect.objectContaining({
            voiceMemoTier: 'RESTORE_IN_PROGRESS',
          }),
        }),
      );
      expect(res.status).toBe('REQUESTED');
    });

    it('GCS backend → calls restoreToStandardClass + flips tier HOT immediately', async () => {
      mockStorage.backend = 'gcs';
      mockPrisma.callLog.findFirst.mockResolvedValue({
        id: 'cl-1',
        voiceMemoUrl: 'voice-memos/cl-1.mp3',
        voiceMemoTier: 'GLACIER',
      });
      mockStorage.restoreToStandardClass.mockResolvedValue({ ok: true });

      const res = await service.requestRestore('cl-1', 'user-1');
      expect(mockStorage.restoreToStandardClass).toHaveBeenCalledWith(
        'voice-memos/cl-1.mp3',
      );
      expect(mockPrisma.callLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cl-1' },
          data: expect.objectContaining({
            voiceMemoTier: 'HOT',
            voiceMemoGlacierRestoreExpiresAt: null,
          }),
        }),
      );
      expect(res.status).toBe('RESTORED');
    });

    it('skips Glacier API + only flips tier when storage backend is "none" (dev mode)', async () => {
      mockStorage.backend = 'none';
      mockPrisma.callLog.findFirst.mockResolvedValue({
        id: 'cl-1',
        voiceMemoUrl: 'voice-memos/cl-1.mp3',
        voiceMemoTier: 'GLACIER',
      });
      const res = await service.requestRestore('cl-1', 'user-1');
      expect(mockStorage.requestGlacierRestore).not.toHaveBeenCalled();
      expect(mockStorage.restoreToStandardClass).not.toHaveBeenCalled();
      expect(res.status).toBe('REQUESTED');
    });
  });

  describe('pollPendingRestores (cron tick)', () => {
    it('marks complete restores as HOT and writes a notification', async () => {
      mockStorage.backend = 's3';
      mockPrisma.callLog.findMany.mockResolvedValue([
        {
          id: 'cl-1',
          callerId: 'user-1',
          voiceMemoUrl: 'voice-memos/cl-1.mp3',
          voiceMemoTier: 'RESTORE_IN_PROGRESS',
        },
        {
          id: 'cl-2',
          callerId: 'user-2',
          voiceMemoUrl: 'voice-memos/cl-2.mp3',
          voiceMemoTier: 'RESTORE_IN_PROGRESS',
        },
      ]);
      mockStorage.isRestoreComplete
        .mockResolvedValueOnce(true) // cl-1 done
        .mockResolvedValueOnce(false); // cl-2 still in flight

      const result = await service.pollPendingRestores();
      expect(result.checked).toBe(2);
      expect(result.completed).toBe(1);
      expect(mockPrisma.callLog.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.callLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cl-1' },
          data: expect.objectContaining({ voiceMemoTier: 'HOT' }),
        }),
      );
      // Notification created for completed restore
      expect(mockPrisma.notificationLog.create).toHaveBeenCalledTimes(1);
    });

    it('returns zero counts when no pending restores exist', async () => {
      mockPrisma.callLog.findMany.mockResolvedValue([]);
      const result = await service.pollPendingRestores();
      expect(result).toEqual({ checked: 0, completed: 0 });
    });
  });
});
