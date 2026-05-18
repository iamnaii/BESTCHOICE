import { ForbiddenException } from '@nestjs/common';
import { PostPermissionGuard } from '../post-permission.guard';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * D1.3.2.3 — PostPermissionGuard dynamic role gating for
 * `POST /expense-documents/:id/post`.
 *
 * Default: 'OWNER+FINANCE_MANAGER+ACCOUNTANT' — matches the pre-existing
 * static `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` decorator.
 */

function makeContext(user: { role?: string } | null) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as Parameters<PostPermissionGuard['canActivate']>[0];
}

describe('PostPermissionGuard', () => {
  let prisma: { systemConfig: { findFirst: jest.Mock } };
  let guard: PostPermissionGuard;

  beforeEach(() => {
    prisma = {
      systemConfig: { findFirst: jest.fn() },
    };
    guard = new PostPermissionGuard(prisma as unknown as PrismaService);
  });

  it('defaults to OWNER+FINANCE_MANAGER+ACCOUNTANT when SystemConfig row missing (current behavior)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'FINANCE_MANAGER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'ACCOUNTANT' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'BRANCH_MANAGER' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.canActivate(makeContext({ role: 'SALES' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('OWNER+FINANCE_MANAGER narrows access (excludes ACCOUNTANT)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'OWNER+FINANCE_MANAGER' });
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'FINANCE_MANAGER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'ACCOUNTANT' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('OWNER_ONLY further narrows access to OWNER only', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'OWNER_ONLY' });
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'FINANCE_MANAGER' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.canActivate(makeContext({ role: 'ACCOUNTANT' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('OWNER+ALL_NON_SALES adds BRANCH_MANAGER, still excludes SALES', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'OWNER+ALL_NON_SALES' });
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'FINANCE_MANAGER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'BRANCH_MANAGER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'ACCOUNTANT' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'SALES' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
