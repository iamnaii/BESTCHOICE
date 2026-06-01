import { ForbiddenException } from '@nestjs/common';
import { ReversePermissionGuard } from '../reverse-permission.guard';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * D1.3.2.4 + InternalControlActionBar — ReversePermissionGuard dynamic role
 * gating for the reverse/void endpoints across Other Income, Expense, Asset.
 *
 * Default: 'OWNER+FINANCE_MANAGER' (legacy behavior). New modes:
 *   - OWNER_ONLY
 *   - OWNER+FINANCE_MANAGER+ACCOUNTANT
 *   - CUSTOM (per-user via User.canReverseOverride)
 */

function makeContext(user: { id?: string; role?: string } | null) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as Parameters<ReversePermissionGuard['canActivate']>[0];
}

describe('ReversePermissionGuard', () => {
  let prisma: {
    systemConfig: { findFirst: jest.Mock };
    user: { findFirst: jest.Mock };
  };
  let guard: ReversePermissionGuard;

  beforeEach(() => {
    prisma = {
      systemConfig: { findFirst: jest.fn() },
      user: { findFirst: jest.fn() },
    };
    guard = new ReversePermissionGuard(prisma as unknown as PrismaService);
  });

  describe('default mode (OWNER+FINANCE_MANAGER)', () => {
    it('defaults to OWNER+FINANCE_MANAGER when SystemConfig row missing (legacy behavior)', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue(null);
      await expect(
        guard.canActivate(makeContext({ id: 'u1', role: 'OWNER' })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ id: 'u2', role: 'FINANCE_MANAGER' })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ id: 'u3', role: 'ACCOUNTANT' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('falls back to default on malformed value (e.g. typo)', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'OWNER+EVERYONE' });
      await expect(
        guard.canActivate(makeContext({ id: 'u1', role: 'OWNER' })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ id: 'u2', role: 'FINANCE_MANAGER' })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ id: 'u3', role: 'ACCOUNTANT' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('falls back to default on DB error', async () => {
      prisma.systemConfig.findFirst.mockRejectedValue(new Error('db down'));
      await expect(
        guard.canActivate(makeContext({ id: 'u1', role: 'OWNER' })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ id: 'u3', role: 'ACCOUNTANT' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('OWNER_ONLY mode', () => {
    it('narrows to OWNER only — rejects FINANCE_MANAGER', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'OWNER_ONLY' });
      await expect(
        guard.canActivate(makeContext({ id: 'u1', role: 'OWNER' })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ id: 'u2', role: 'FINANCE_MANAGER' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('OWNER+FINANCE_MANAGER+ACCOUNTANT mode', () => {
    it('widens to include ACCOUNTANT', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({
        value: 'OWNER+FINANCE_MANAGER+ACCOUNTANT',
      });
      await expect(
        guard.canActivate(makeContext({ id: 'u1', role: 'OWNER' })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ id: 'u2', role: 'FINANCE_MANAGER' })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ id: 'u3', role: 'ACCOUNTANT' })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(makeContext({ id: 'u4', role: 'SALES' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('CUSTOM mode (per-user override)', () => {
    beforeEach(() => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'CUSTOM' });
    });

    it('OWNER always allowed regardless of override flag', async () => {
      // user.findFirst is never called for OWNER (short-circuit)
      await expect(
        guard.canActivate(makeContext({ id: 'owner1', role: 'OWNER' })),
      ).resolves.toBe(true);
    });

    it('user with canReverseOverride=true is allowed', async () => {
      prisma.user.findFirst.mockResolvedValue({ canReverseOverride: true });
      await expect(
        guard.canActivate(makeContext({ id: 'acc1', role: 'ACCOUNTANT' })),
      ).resolves.toBe(true);
    });

    it('user with canReverseOverride=false is denied', async () => {
      prisma.user.findFirst.mockResolvedValue({ canReverseOverride: false });
      await expect(
        guard.canActivate(makeContext({ id: 'acc1', role: 'ACCOUNTANT' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('user with canReverseOverride=null is denied (no opt-in)', async () => {
      prisma.user.findFirst.mockResolvedValue({ canReverseOverride: null });
      await expect(
        guard.canActivate(makeContext({ id: 'sales1', role: 'SALES' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('user not found is denied', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        guard.canActivate(makeContext({ id: 'ghost', role: 'SALES' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('missing user/role rejects with Forbidden', () => {
    it('rejects when request.user is missing', async () => {
      await expect(guard.canActivate(makeContext(null))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects when role is missing', async () => {
      await expect(
        guard.canActivate(makeContext({ id: 'u1' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when id is missing', async () => {
      await expect(
        guard.canActivate(makeContext({ role: 'OWNER' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
