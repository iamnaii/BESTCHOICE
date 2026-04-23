import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { KycService } from './kyc.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('KycService', () => {
  let service: KycService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;

  const mockContract = {
    id: 'contract-1',
    contractNumber: 'BC-2026-001',
    deletedAt: null,
    customer: {
      id: 'customer-1',
      phone: '0891234567',
      lineId: 'U1234567890',
    },
  };

  const mockKycRecord = {
    id: 'kyc-1',
    contractId: 'contract-1',
    customerId: 'customer-1',
    otpHash: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', // sha256('1234')
    otpPhone: '0891234567',
    otpChannel: 'SMS',
    otpAttempts: 0,
    otpSentCount: 1,
    otpVerifiedAt: null,
    idCardImageUrl: null,
    idCardVerified: false,
    ipAddress: '127.0.0.1',
    deviceInfo: 'test-agent',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min from now
    createdAt: new Date(),
  };

  const mockPrisma = {
    contract: {
      findUnique: jest.fn().mockResolvedValue(mockContract),
    },
    kycVerification: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(mockKycRecord),
      findFirst: jest.fn().mockResolvedValue(mockKycRecord),
      update: jest.fn().mockResolvedValue(mockKycRecord),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const mockNotifications = {
    send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }),
  };

  beforeEach(async () => {
    // Reset mocks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.values(mockPrisma.contract).forEach((fn: any) => fn.mockClear());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.values(mockPrisma.kycVerification).forEach((fn: any) => fn.mockClear());
    mockNotifications.send.mockClear();

    // Reset default return values
    mockPrisma.contract.findUnique.mockResolvedValue(mockContract);
    mockPrisma.kycVerification.count.mockResolvedValue(0);
    mockPrisma.kycVerification.create.mockResolvedValue(mockKycRecord);
    mockPrisma.kycVerification.findFirst.mockResolvedValue(mockKycRecord);
    mockPrisma.kycVerification.update.mockResolvedValue(mockKycRecord);
    mockNotifications.send.mockResolvedValue({ id: 'notif-1', status: 'SENT' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<KycService>(KycService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
  });

  // ─── sendOtp ─────────────────────────────────────────
  describe('sendOtp', () => {
    const req = { ip: '127.0.0.1', userAgent: 'test-agent' };

    it('should send OTP via SMS successfully', async () => {
      const result = await service.sendOtp('contract-1', req);

      expect(result).toBeDefined();
      expect(result.channel).toBe('SMS');
      expect(result.phone).toContain('xxx');
      expect(prisma.kycVerification.create).toHaveBeenCalled();
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'SMS',
          recipient: '0891234567',
        }),
      );
    });

    it('should always persist otpChannel as SMS (LINE channel removed 2026-04-23)', async () => {
      await service.sendOtp('contract-1', req);

      const createArgs = prisma.kycVerification.create.mock.calls[0][0];
      expect(createArgs.data.otpChannel).toBe('SMS');
    });

    it('should expire existing pending verifications', async () => {
      await service.sendOtp('contract-1', req);

      expect(prisma.kycVerification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ contractId: 'contract-1' }),
          data: { status: 'EXPIRED' },
        }),
      );
    });

    it('should throw NotFoundException when contract not found', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(null);

      await expect(service.sendOtp('nonexistent', req)).rejects.toThrow(NotFoundException);
    });

    it('should reject when rate limit exceeded (3 sends/hour)', async () => {
      prisma.kycVerification.count.mockResolvedValue(3);

      await expect(service.sendOtp('contract-1', req)).rejects.toThrow(BadRequestException);
      await expect(service.sendOtp('contract-1', req)).rejects.toThrow(/เกินจำนวน/);
    });

    it('should throw BadRequestException when customer has no phone', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce({
        ...mockContract,
        customer: { ...mockContract.customer, phone: null },
      });

      await expect(service.sendOtp('contract-1', req)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when notification service fails', async () => {
      notifications.send.mockRejectedValueOnce(new Error('Send failed'));

      await expect(service.sendOtp('contract-1', req)).rejects.toThrow(BadRequestException);
      // No DB record should be created when send fails
      expect(prisma.kycVerification.create).not.toHaveBeenCalled();
      expect(prisma.kycVerification.updateMany).not.toHaveBeenCalled();
    });

    it('should not create KYC record when notification returns FAILED status', async () => {
      notifications.send.mockResolvedValueOnce({ id: 'notif-1', status: 'FAILED' });

      await expect(service.sendOtp('contract-1', req)).rejects.toThrow(BadRequestException);
      expect(prisma.kycVerification.create).not.toHaveBeenCalled();
      expect(prisma.kycVerification.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─── verifyOtp ───────────────────────────────────────
  describe('verifyOtp', () => {
    it('should verify correct OTP', async () => {
      // We need to match the OTP hash. The service hashes the input and compares.
      // mockKycRecord.otpHash is sha256('1234'), so we need the service to hash to the same.
      // But the OTP is random in sendOtp. For verifyOtp, we test with a known hash.
      const otp = '123456';
      const hash = crypto.createHash('sha256').update(otp).digest('hex');

      prisma.kycVerification.findFirst.mockResolvedValueOnce({
        ...mockKycRecord,
        otpHash: hash,
      });

      const result = await service.verifyOtp('contract-1', otp);

      expect(result.verified).toBe(true);
      expect(prisma.kycVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'OTP_VERIFIED' }),
        }),
      );
    });

    it('should reject invalid OTP in all environments (no dev bypass)', async () => {
      // Security regression guard — invalid OTP must always be rejected,
      // never silently accepted in non-prod environments.
      prisma.kycVerification.findFirst.mockResolvedValue({
        ...mockKycRecord,
        otpHash: 'correct-hash-that-wont-match',
      });

      await expect(service.verifyOtp('contract-1', 'wrong')).rejects.toThrow(BadRequestException);
      await expect(service.verifyOtp('contract-1', 'wrong')).rejects.toThrow(/OTP ไม่ถูกต้อง/);
    });

    it('should throw when OTP expired (in all environments)', async () => {
      // T3-C1 fix: expiry check runs regardless of NODE_ENV
      prisma.kycVerification.findFirst.mockResolvedValue({
        ...mockKycRecord,
        expiresAt: new Date(Date.now() - 1000), // expired
      });

      await expect(service.verifyOtp('contract-1', '123456')).rejects.toThrow(BadRequestException);
      await expect(service.verifyOtp('contract-1', '123456')).rejects.toThrow(/หมดอายุ/);
    });

    it('should throw when max attempts reached (in all environments)', async () => {
      // T3-C1 fix: attempt count check runs regardless of NODE_ENV
      prisma.kycVerification.findFirst.mockResolvedValue({
        ...mockKycRecord,
        otpAttempts: 5,
      });

      await expect(service.verifyOtp('contract-1', '123456')).rejects.toThrow(BadRequestException);
      await expect(service.verifyOtp('contract-1', '123456')).rejects.toThrow(/เกินจำนวน/);
    });

    it('should increment otpAttempts on wrong OTP', async () => {
      // T3-C1 fix: verify attempt counter increments correctly (no dev bypass short-circuits this)
      prisma.kycVerification.findFirst.mockResolvedValueOnce({
        ...mockKycRecord,
        otpHash: 'correct-hash-that-wont-match',
        otpAttempts: 2,
      });

      await expect(service.verifyOtp('contract-1', 'wrong')).rejects.toThrow(BadRequestException);
      expect(prisma.kycVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ otpAttempts: 3 }),
        }),
      );
    });

    it('should NOT bypass OTP even if NODE_ENV is development', async () => {
      // T3-C1 security regression guard: prevent accidentally reintroducing the DEV bypass.
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        prisma.kycVerification.findFirst.mockResolvedValueOnce({
          ...mockKycRecord,
          otpHash: 'correct-hash-that-wont-match',
        });

        await expect(service.verifyOtp('contract-1', 'anything')).rejects.toThrow(
          BadRequestException,
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should throw when no pending KYC record found', async () => {
      prisma.kycVerification.findFirst.mockResolvedValueOnce(null);

      await expect(service.verifyOtp('contract-1', '123456')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── uploadIdCard ────────────────────────────────────
  describe('uploadIdCard', () => {
    const req = { ip: '127.0.0.1', userAgent: 'test-agent' };
    const validBase64 = 'data:image/jpeg;base64,/9j/small-image';

    it('should upload ID card and mark KYC as VERIFIED', async () => {
      prisma.kycVerification.findFirst.mockResolvedValueOnce({
        ...mockKycRecord,
        status: 'OTP_VERIFIED',
        otpVerifiedAt: new Date(),
      });

      const result = await service.uploadIdCard('contract-1', validBase64, req);

      expect(result.verified).toBe(true);
      expect(result.status).toBe('VERIFIED');
      expect(prisma.kycVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idCardVerified: true,
            status: 'VERIFIED',
          }),
        }),
      );
    });

    it('should reject when OTP not yet verified', async () => {
      prisma.kycVerification.findFirst.mockResolvedValueOnce(null);

      await expect(service.uploadIdCard('contract-1', validBase64, req)).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid image format', async () => {
      prisma.kycVerification.findFirst.mockResolvedValueOnce({
        ...mockKycRecord,
        status: 'OTP_VERIFIED',
      });

      await expect(
        service.uploadIdCard('contract-1', 'not-a-valid-base64-image', req),
      ).rejects.toThrow(/รูปภาพไม่ถูกต้อง/);
    });

    it('should reject oversized images (>5MB)', async () => {
      prisma.kycVerification.findFirst.mockResolvedValueOnce({
        ...mockKycRecord,
        status: 'OTP_VERIFIED',
      });

      const largeImage = 'data:image/jpeg;base64,' + 'A'.repeat(7 * 1024 * 1024);

      await expect(
        service.uploadIdCard('contract-1', largeImage, req),
      ).rejects.toThrow(/5MB/);
    });
  });

  // ─── getStatus ───────────────────────────────────────
  describe('getStatus', () => {
    it('should return status when KYC record exists', async () => {
      prisma.kycVerification.findFirst.mockResolvedValueOnce({
        ...mockKycRecord,
        status: 'VERIFIED',
        otpVerifiedAt: new Date(),
        idCardVerified: true,
      });

      const result = await service.getStatus('contract-1');

      expect(result.status).toBe('VERIFIED');
      expect(result.otpVerified).toBe(true);
      expect(result.idCardUploaded).toBe(true);
    });

    it('should return NOT_STARTED when no KYC record', async () => {
      prisma.kycVerification.findFirst.mockResolvedValueOnce(null);

      const result = await service.getStatus('contract-1');

      expect(result.status).toBe('NOT_STARTED');
      expect(result.otpVerified).toBe(false);
      expect(result.idCardUploaded).toBe(false);
    });

    it('should mask phone number in response', async () => {
      const result = await service.getStatus('contract-1');

      expect(result.otpPhone).toContain('xxx');
      expect(result.otpPhone).not.toBe('0891234567');
    });
  });
});
