import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LoginAuditService } from './login-audit.service';

const mockEmailSender = { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;

  const mockUser = {
    id: 'user-1',
    email: 'test@test.com',
    password: '', // will be set in beforeAll
    name: 'Test User',
    role: 'SALES',
    branchId: 'branch-1',
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    deletedAt: null,
    twoFactorEnabled: false,
    twoFactorRequiredAfter: null,
    branch: { id: 'branch-1', name: 'สาขาทดสอบ' },
  };

  beforeAll(async () => {
    mockUser.password = await bcrypt.hash('password123', 10);
  });

  beforeEach(async () => {
    mockEmailSender.sendPasswordResetEmail.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            refreshToken: {
              create: jest.fn().mockResolvedValue({ id: 'rt-1', token: 'mock-refresh-token' }),
              findFirst: jest.fn().mockResolvedValue(null),
              findUnique: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            passwordResetToken: {
              create: jest.fn().mockResolvedValue({ id: 'prt-1' }),
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            $transaction: jest.fn().mockImplementation((args) => {
              // Batch transaction: execute all promises in the array
              if (Array.isArray(args)) return Promise.all(args);
              // Interactive transaction: pass mock prisma as tx
              return args({ user: { findUnique: jest.fn() }, refreshToken: { create: jest.fn(), update: jest.fn() } });
            }),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-access-token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                JWT_SECRET: 'test-secret',
                JWT_REFRESH_SECRET: 'test-refresh-secret',
                JWT_EXPIRATION: '15m',
                JWT_REFRESH_EXPIRATION: '7d',
              };
              return config[key];
            }),
          },
        },
        {
          provide: EmailService,
          useValue: mockEmailSender,
        },
        {
          provide: LoginAuditService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('login', () => {
    it('should return AUTHENTICATED state with tokens on successful login', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.login({
        email: 'test@test.com',
        password: 'password123',
      });

      expect(result.state).toBe('AUTHENTICATED');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      if (result.state === 'AUTHENTICATED') {
        expect((result.user as { email: string }).email).toBe('test@test.com');
        expect((result.user as { role: string }).role).toBe('SALES');
      }
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('should throw on invalid email', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.login({ email: 'wrong@test.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw on invalid password', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.login({ email: 'test@test.com', password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw if user is inactive', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(
        service.login({ email: 'test@test.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('increments failedLoginAttempts on wrong password', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...mockUser, failedLoginAttempts: 2 });

      await expect(
        service.login({ email: 'test@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);

      const updateCall = (prisma.user.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.failedLoginAttempts).toBe(3);
      expect(updateCall.data.lockedUntil).toBeNull();
    });

    it('locks account when failedLoginAttempts reaches threshold (5)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...mockUser, failedLoginAttempts: 4 });

      await expect(
        service.login({ email: 'test@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);

      const updateCall = (prisma.user.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.failedLoginAttempts).toBe(5);
      expect(updateCall.data.lockedUntil).toBeInstanceOf(Date);
    });

    it('rejects login while account is locked, even with the correct password', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        lockedUntil: new Date(Date.now() + 60_000), // locked for 1 more minute
      });

      await expect(
        service.login({ email: 'test@test.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);

      // Should NOT have called create on refreshToken (login was blocked)
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('allows login after lock has expired', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 5,
        lockedUntil: new Date(Date.now() - 1_000), // expired 1 second ago
      });

      const result = await service.login({ email: 'test@test.com', password: 'password123' });
      expect(result).toHaveProperty('accessToken');
      // Counter and lock should be reset
      const updateCall = (prisma.user.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.failedLoginAttempts).toBe(0);
      expect(updateCall.data.lockedUntil).toBeNull();
    });

    it('resets failedLoginAttempts to 0 on successful login', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...mockUser, failedLoginAttempts: 3 });

      await service.login({ email: 'test@test.com', password: 'password123' });

      const updateCall = (prisma.user.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.failedLoginAttempts).toBe(0);
    });
  });

  describe('refreshToken', () => {
    it('should return new tokens with valid refresh token', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
        id: 'rt-1',
        token: 'valid-refresh-token',
        userId: 'user-1',
        expiresAt: futureDate,
        revokedAt: null,
      });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.refreshToken('valid-refresh-token');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      // Token rotation now uses atomic $transaction([revoke, create])
      expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).toHaveBeenCalled();
    });

    it('should throw on revoked refresh token', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
        id: 'rt-1',
        token: 'revoked-token',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(),
      });

      await expect(service.refreshToken('revoked-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw on expired refresh token', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
        id: 'rt-1',
        token: 'expired-token',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 86400000),
        revokedAt: null,
      });

      await expect(service.refreshToken('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw on unknown token', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.refreshToken('unknown-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should revoke all refresh tokens for the user', async () => {
      await service.logout('some-token', 'user-123');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', isRevoked: false },
        data: { isRevoked: true, revokedAt: expect.any(Date) },
      });
    });
  });

  // ─── 2-step login state machine (Task 4) ─────────────────────────────────

  describe('login — 2FA state machine', () => {
    it('returns state AUTHENTICATED when user has no 2FA and no setup deadline', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        twoFactorEnabled: false,
        twoFactorRequiredAfter: null,
      });

      const result = await service.login({ email: 'test@test.com', password: 'password123' });
      expect(result.state).toBe('AUTHENTICATED');
      if (result.state === 'AUTHENTICATED') {
        expect(result).toHaveProperty('accessToken');
        expect(result).toHaveProperty('refreshToken');
      }
    });

    it('returns state OTP_REQUIRED + tempToken when user has 2FA enabled', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        twoFactorEnabled: true,
        twoFactorRequiredAfter: null,
      });

      const result = await service.login({ email: 'test@test.com', password: 'password123' });
      expect(result.state).toBe('OTP_REQUIRED');
      if (result.state === 'OTP_REQUIRED') {
        expect(typeof result.tempToken).toBe('string');
        expect(result.tempToken.length).toBeGreaterThan(10);
      }
      // Full tokens must NOT be returned
      expect((result as Record<string, unknown>)).not.toHaveProperty('accessToken');
    });

    it('returns state 2FA_SETUP_REQUIRED when enrollment deadline has passed', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        twoFactorEnabled: false,
        twoFactorRequiredAfter: new Date(Date.now() - 1000), // deadline was 1 second ago
      });

      const result = await service.login({ email: 'test@test.com', password: 'password123' });
      expect(result.state).toBe('2FA_SETUP_REQUIRED');
      if (result.state === '2FA_SETUP_REQUIRED') {
        expect(typeof result.tempToken).toBe('string');
      }
    });

    it('loginWithTempToken returns full JWT after valid OTP verification', async () => {
      // Mock the user lookup inside loginWithTempToken
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        twoFactorEnabled: true,
        branch: { id: 'branch-1', name: 'สาขาทดสอบ' },
      });

      // Generate a tempToken via internal sign (simulate OTP_REQUIRED state)
      const mockTwoFactorSvc = {
        verifyLogin: jest.fn().mockResolvedValue({ method: 'TOTP' }),
      };

      // We need a real JWT for tempToken — use JwtService mock to return signed value
      // The mock JwtService.sign returns 'mock-access-token'
      // and JwtService.verify is not mocked — so let's create a valid temp token via sign
      // Since JwtService is mocked, we instead test that the service calls verifyTempToken
      // and on valid result proceeds to issue full tokens.
      // Use a real jwtService for this specific test would be better, so instead verify behavior:
      const mockVerifyResult = { sub: 'user-1', scope: '2fa_login' };

      // Monkey-patch verifyTempToken (private) by calling loginWithTempToken with a stub
      // that bypasses the real verify — since jwtService.verify is not set up to return correct
      // audience-verified payload in the mock, we test the downstream behavior instead.
      // The approach: spy on the service's private method via (service as any).
      jest.spyOn(service as unknown as Record<string, unknown>, 'verifyTempToken' as never)
        .mockReturnValue(mockVerifyResult as never);

      const result = await service.loginWithTempToken(
        'mock-temp-token',
        '123456',
        mockTwoFactorSvc,
      );

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockTwoFactorSvc.verifyLogin).toHaveBeenCalledWith('user-1', '123456');
    });
  });

  describe('forgotPassword (T7-C2 per-email rate limit)', () => {
    const existingUser = {
      id: 'user-42',
      name: 'User 42',
      email: 'ratelimit@test.com',
      isActive: true,
      deletedAt: null,
    };

    it('sends email for the first 3 requests in the window', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

      for (let i = 0; i < 3; i++) {
        const res = await service.forgotPassword({ email: 'ratelimit@test.com' });
        expect(res).toEqual({ message: expect.any(String) });
      }

      expect(mockEmailSender.sendPasswordResetEmail).toHaveBeenCalledTimes(3);
    });

    it('silently suppresses the 4th request within the window (still 200, no email)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

      // Burn through the 3 allowed requests
      await service.forgotPassword({ email: 'ratelimit@test.com' });
      await service.forgotPassword({ email: 'ratelimit@test.com' });
      await service.forgotPassword({ email: 'ratelimit@test.com' });
      expect(mockEmailSender.sendPasswordResetEmail).toHaveBeenCalledTimes(3);

      // 4th hit: must still resolve with a generic success message
      // (no exception — enumeration-resistance) but must NOT send email
      const res = await service.forgotPassword({ email: 'ratelimit@test.com' });
      expect(res).toEqual({ message: expect.any(String) });
      expect(mockEmailSender.sendPasswordResetEmail).toHaveBeenCalledTimes(3);

      // Must NOT create a DB token either — saves writes on abusive input
      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(3);
    });

    it('treats email as case-insensitive for the rate limit', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

      await service.forgotPassword({ email: 'Case@Test.Com' });
      await service.forgotPassword({ email: 'case@test.com' });
      await service.forgotPassword({ email: 'CASE@TEST.COM' });

      // 4th should be suppressed regardless of casing
      await service.forgotPassword({ email: 'case@test.com' });
      expect(mockEmailSender.sendPasswordResetEmail).toHaveBeenCalledTimes(3);
    });
  });
});
