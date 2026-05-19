import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard, __resetViewerFlagCacheForTests } from './roles.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * RolesGuard behavior:
 *   - No @Roles() metadata → allow (route is public to all authenticated users)
 *   - No user on request → deny
 *   - User.role NOT in requiredRoles → deny
 *   - User.role IN requiredRoles AND not VIEWER → allow
 *   - User.role === 'VIEWER':
 *       → check SystemConfig `viewer_role_enabled` (cached 60s)
 *       → 'true' allows, 'false'/missing/DB-error denies
 */
describe('RolesGuard', () => {
  let reflector: Reflector;
  let prisma: { systemConfig: { findFirst: jest.Mock } };
  let guard: RolesGuard;

  function makeCtx(user: { role: string } | null, requiredRoles: string[] | undefined): ExecutionContext {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => (key === ROLES_KEY ? requiredRoles : undefined));
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    __resetViewerFlagCacheForTests();
    reflector = new Reflector();
    prisma = { systemConfig: { findFirst: jest.fn() } };
    guard = new RolesGuard(reflector, prisma as unknown as PrismaService);
  });

  it('allows when no @Roles() metadata is set on the route', async () => {
    const ctx = makeCtx({ role: 'OWNER' }, undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.systemConfig.findFirst).not.toHaveBeenCalled();
  });

  it('denies when user is missing from request', async () => {
    const ctx = makeCtx(null, ['OWNER']);
    await expect(guard.canActivate(ctx)).resolves.toBe(false);
  });

  it('denies when user.role is not in requiredRoles', async () => {
    const ctx = makeCtx({ role: 'SALES' }, ['OWNER', 'FINANCE_MANAGER']);
    await expect(guard.canActivate(ctx)).resolves.toBe(false);
    expect(prisma.systemConfig.findFirst).not.toHaveBeenCalled();
  });

  it('allows when non-VIEWER user.role is in requiredRoles', async () => {
    const ctx = makeCtx({ role: 'ACCOUNTANT' }, ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER']);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // No DB call needed for non-VIEWER users.
    expect(prisma.systemConfig.findFirst).not.toHaveBeenCalled();
  });

  describe('VIEWER gate', () => {
    it("denies VIEWER when SystemConfig row is missing (default 'false')", async () => {
      prisma.systemConfig.findFirst.mockResolvedValue(null);
      const ctx = makeCtx({ role: 'VIEWER' }, ['OWNER', 'VIEWER']);
      await expect(guard.canActivate(ctx)).resolves.toBe(false);
      expect(prisma.systemConfig.findFirst).toHaveBeenCalledWith({
        where: { key: 'viewer_role_enabled', deletedAt: null },
        select: { value: true },
      });
    });

    it("denies VIEWER when SystemConfig value === 'false'", async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
      const ctx = makeCtx({ role: 'VIEWER' }, ['VIEWER']);
      await expect(guard.canActivate(ctx)).resolves.toBe(false);
    });

    it("allows VIEWER when SystemConfig value === 'true' AND requiredRoles includes VIEWER", async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
      const ctx = makeCtx({ role: 'VIEWER' }, ['OWNER', 'ACCOUNTANT', 'VIEWER']);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('denies VIEWER on routes that DO NOT list VIEWER in @Roles()', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
      const ctx = makeCtx({ role: 'VIEWER' }, ['OWNER', 'ACCOUNTANT']);
      await expect(guard.canActivate(ctx)).resolves.toBe(false);
      // Short-circuits BEFORE the DB lookup — user.role missing from
      // requiredRoles is the cheaper-to-compute condition.
      expect(prisma.systemConfig.findFirst).not.toHaveBeenCalled();
    });

    it('denies VIEWER (fail closed) when SystemConfig read throws', async () => {
      prisma.systemConfig.findFirst.mockRejectedValue(new Error('DB unreachable'));
      const ctx = makeCtx({ role: 'VIEWER' }, ['VIEWER']);
      await expect(guard.canActivate(ctx)).resolves.toBe(false);
    });

    it('caches the SystemConfig lookup across requests (single DB read per TTL)', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
      const ctx1 = makeCtx({ role: 'VIEWER' }, ['VIEWER']);
      await guard.canActivate(ctx1);
      const ctx2 = makeCtx({ role: 'VIEWER' }, ['VIEWER']);
      await guard.canActivate(ctx2);
      const ctx3 = makeCtx({ role: 'VIEWER' }, ['VIEWER']);
      await guard.canActivate(ctx3);
      expect(prisma.systemConfig.findFirst).toHaveBeenCalledTimes(1);
    });

    it('refreshes the cache after TTL expires', async () => {
      jest.useFakeTimers();
      try {
        prisma.systemConfig.findFirst
          .mockResolvedValueOnce({ value: 'true' })
          .mockResolvedValueOnce({ value: 'false' });

        const ctx1 = makeCtx({ role: 'VIEWER' }, ['VIEWER']);
        await expect(guard.canActivate(ctx1)).resolves.toBe(true);

        // Advance past 60s TTL.
        jest.advanceTimersByTime(61_000);

        const ctx2 = makeCtx({ role: 'VIEWER' }, ['VIEWER']);
        await expect(guard.canActivate(ctx2)).resolves.toBe(false);

        expect(prisma.systemConfig.findFirst).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
