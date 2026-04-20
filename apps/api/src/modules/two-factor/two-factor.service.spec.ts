import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from '@otplib/preset-default';
import { TwoFactorService } from './two-factor.service';
import { PrismaService } from '../../prisma/prisma.service';

// Generate a real TOTP secret for tests
const TEST_SECRET = authenticator.generateSecret();

function makeMockUser(overrides: Partial<{
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  twoFactorBackupCodes: string[] | null;
  email: string;
}> = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    twoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorBackupCodes: null,
    ...overrides,
  };
}

describe('TwoFactorService', () => {
  let service: TwoFactorService;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            // No ENCRYPTION_KEY → fallback plain text (simpler for tests)
            get: jest.fn().mockReturnValue(''),
          },
        },
      ],
    }).compile();

    service = module.get<TwoFactorService>(TwoFactorService);
  });

  // ─── startEnrollment ────────────────────────────────────────────────────

  describe('startEnrollment', () => {
    it('returns secret + otpAuthUrl + qrCodeDataUrl and stores encrypted secret', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({ twoFactorEnabled: false }),
      );

      const result = await service.startEnrollment('user-1');

      expect(result).toHaveProperty('secret');
      expect(result).toHaveProperty('otpAuthUrl');
      expect(result.otpAuthUrl).toContain('otpauth://totp/');
      expect(result).toHaveProperty('qrCodeDataUrl');
      expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } }),
      );
    });

    it('throws BadRequestException if 2FA already enabled', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({ twoFactorEnabled: true }),
      );

      await expect(service.startEnrollment('user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.startEnrollment('user-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── confirmEnrollment ──────────────────────────────────────────────────

  describe('confirmEnrollment', () => {
    it('enables 2FA and returns 10 plain-text backup codes on valid TOTP', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({ twoFactorEnabled: false, twoFactorSecret: TEST_SECRET }),
      );

      const validToken = authenticator.generate(TEST_SECRET);
      const result = await service.confirmEnrollment('user-1', validToken);

      expect(result.backupCodes).toHaveLength(10);
      result.backupCodes.forEach((code) => {
        expect(code).toMatch(/^[0-9A-F]{8}$/);
      });

      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data.twoFactorEnabled).toBe(true);
      expect(updateCall.data.twoFactorEnabledAt).toBeInstanceOf(Date);
      // Stored codes should be hashes, not plain text
      const storedCodes = updateCall.data.twoFactorBackupCodes as string[];
      expect(storedCodes).toHaveLength(10);
      expect(storedCodes[0]).not.toBe(result.backupCodes[0]); // stored ≠ plain text
    });

    it('throws BadRequestException on invalid TOTP token', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({ twoFactorEnabled: false, twoFactorSecret: TEST_SECRET }),
      );

      await expect(service.confirmEnrollment('user-1', '000000')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if secret not set (enroll not started)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({ twoFactorEnabled: false, twoFactorSecret: null }),
      );

      await expect(service.confirmEnrollment('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── verifyLogin ─────────────────────────────────────────────────────────

  describe('verifyLogin', () => {
    it('returns { method: TOTP } on valid TOTP token', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({
          twoFactorEnabled: true,
          twoFactorSecret: TEST_SECRET,
          twoFactorBackupCodes: [],
        }),
      );

      const validToken = authenticator.generate(TEST_SECRET);
      const result = await service.verifyLogin('user-1', validToken);
      expect(result).toEqual({ method: 'TOTP' });
    });

    it('returns { method: BACKUP_CODE } and marks code as used', async () => {
      const crypto = await import('crypto');
      const rawCode = 'ABCD1234';
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');

      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({
          twoFactorEnabled: true,
          twoFactorSecret: TEST_SECRET,
          twoFactorBackupCodes: [codeHash],
        }),
      );

      const result = await service.verifyLogin('user-1', rawCode);
      expect(result).toEqual({ method: 'BACKUP_CODE' });

      // Code should be consumed (removed)
      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data.twoFactorBackupCodes).toHaveLength(0);
    });

    it('throws UnauthorizedException on invalid TOTP and no matching backup code', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({
          twoFactorEnabled: true,
          twoFactorSecret: TEST_SECRET,
          twoFactorBackupCodes: [],
        }),
      );

      await expect(service.verifyLogin('user-1', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('backup code is single-use: second use fails', async () => {
      const crypto = await import('crypto');
      const rawCode = 'FFFF0000';
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');

      // First call: code is present
      prisma.user.findUnique.mockResolvedValueOnce(
        makeMockUser({
          twoFactorEnabled: true,
          twoFactorSecret: TEST_SECRET,
          twoFactorBackupCodes: [codeHash],
        }),
      );

      const first = await service.verifyLogin('user-1', rawCode);
      expect(first.method).toBe('BACKUP_CODE');

      // Second call: code has been removed (simulate empty list)
      prisma.user.findUnique.mockResolvedValueOnce(
        makeMockUser({
          twoFactorEnabled: true,
          twoFactorSecret: TEST_SECRET,
          twoFactorBackupCodes: [], // consumed
        }),
      );

      await expect(service.verifyLogin('user-1', rawCode)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── disable ─────────────────────────────────────────────────────────────

  describe('disable', () => {
    it('disables 2FA when valid TOTP is provided', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({
          twoFactorEnabled: true,
          twoFactorSecret: TEST_SECRET,
          twoFactorBackupCodes: [],
        }),
      );

      const validToken = authenticator.generate(TEST_SECRET);
      const result = await service.disable('user-1', validToken);

      expect(result.message).toContain('สำเร็จ');
      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data.twoFactorEnabled).toBe(false);
      expect(updateCall.data.twoFactorSecret).toBeNull();
    });

    it('throws UnauthorizedException on invalid token', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({
          twoFactorEnabled: true,
          twoFactorSecret: TEST_SECRET,
          twoFactorBackupCodes: [],
        }),
      );

      await expect(service.disable('user-1', '000000')).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException if 2FA not enabled', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({ twoFactorEnabled: false }),
      );

      await expect(service.disable('user-1', '123456')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── regenerateBackupCodes ───────────────────────────────────────────────

  describe('regenerateBackupCodes', () => {
    it('returns 10 new plain-text codes and stores hashes', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({
          twoFactorEnabled: true,
          twoFactorSecret: TEST_SECRET,
        }),
      );

      const validToken = authenticator.generate(TEST_SECRET);
      const result = await service.regenerateBackupCodes('user-1', validToken);

      expect(result.backupCodes).toHaveLength(10);
      result.backupCodes.forEach((code) => {
        expect(code).toMatch(/^[0-9A-F]{8}$/);
      });

      const updateCall = prisma.user.update.mock.calls[0][0];
      const storedCodes = updateCall.data.twoFactorBackupCodes as string[];
      expect(storedCodes).toHaveLength(10);
      // Stored hashes differ from plain text
      expect(storedCodes[0]).not.toBe(result.backupCodes[0]);
    });

    it('throws UnauthorizedException on invalid TOTP', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeMockUser({
          twoFactorEnabled: true,
          twoFactorSecret: TEST_SECRET,
        }),
      );

      await expect(service.regenerateBackupCodes('user-1', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
