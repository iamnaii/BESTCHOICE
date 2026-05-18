import { ForbiddenException } from '@nestjs/common';
import { ReversePermissionGuard } from '../reverse-permission.guard';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * D1.3.2.4 — ReversePermissionGuard dynamic role gating for
 * `POST /expense-documents/:id/void` (reverse).
 *
 * Default: 'OWNER+FINANCE_MANAGER' — matches the pre-existing static
 * `@Roles('OWNER', 'FINANCE_MANAGER')` decorator.
 */

function makeContext(user: { role?: string } | null) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as Parameters<ReversePermissionGuard['canActivate']>[0];
}

describe('ReversePermissionGuard', () => {
  let prisma: { systemConfig: { findFirst: jest.Mock } };
  let guard: ReversePermissionGuard;

  beforeEach(() => {
    prisma = {
      systemConfig: { findFirst: jest.fn() },
    };
    guard = new ReversePermissionGuard(prisma as unknown as PrismaService);
  });

  it('defaults to OWNER+FINANCE_MANAGER when SystemConfig row missing (current behavior)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'FINANCE_MANAGER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'ACCOUNTANT' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('OWNER_ONLY narrows to OWNER only — rejects FINANCE_MANAGER', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'OWNER_ONLY' });
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'FINANCE_MANAGER' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('falls back to default on malformed value (e.g. typo)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'OWNER+EVERYONE' });
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'FINANCE_MANAGER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'ACCOUNTANT' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('falls back to default on DB error', async () => {
    prisma.systemConfig.findFirst.mockRejectedValue(new Error('db down'));
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'ACCOUNTANT' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
