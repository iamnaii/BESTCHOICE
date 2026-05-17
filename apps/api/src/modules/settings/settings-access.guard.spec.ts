import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SettingsAccessGuard, SETTINGS_ACCESS_BYPASS } from './settings-access.guard';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D1.3.2.2 — SettingsAccessGuard dynamic role gating.
 *
 * Conservative default: when SystemConfig key `settings_access_role` is
 * absent / malformed / DB-fails, guard locks down to OWNER only — matches
 * pre-existing `@Roles('OWNER')` behavior.
 */

function makeContext(user: { role?: string } | null, handler: object = {}, classRef: object = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => handler,
    getClass: () => classRef,
  } as unknown as Parameters<SettingsAccessGuard['canActivate']>[0];
}

describe('SettingsAccessGuard', () => {
  let prisma: { systemConfig: { findFirst: jest.Mock } };
  let reflector: Reflector;
  let guard: SettingsAccessGuard;

  beforeEach(() => {
    prisma = {
      systemConfig: { findFirst: jest.fn() },
    };
    reflector = new Reflector();
    guard = new SettingsAccessGuard(reflector, prisma as unknown as PrismaService);
  });

  it('defaults to OWNER-only when SystemConfig row missing', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'ACCOUNTANT' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('OWNER+FINANCE_MANAGER allows FINANCE_MANAGER but not ACCOUNTANT', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'OWNER+FINANCE_MANAGER' });
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'FINANCE_MANAGER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'ACCOUNTANT' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('OWNER+ALL allows OWNER/FINANCE_MANAGER/BRANCH_MANAGER/ACCOUNTANT but NOT SALES', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'OWNER+ALL' });
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'FINANCE_MANAGER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'BRANCH_MANAGER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'ACCOUNTANT' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'SALES' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('falls back to OWNER-only on unknown / malformed value', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'OWNER+EVERYBODY' });
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'FINANCE_MANAGER' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('falls back to OWNER-only on DB error', async () => {
    prisma.systemConfig.findFirst.mockRejectedValue(new Error('db down'));
    await expect(guard.canActivate(makeContext({ role: 'OWNER' }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ role: 'ACCOUNTANT' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('bypass marker (e.g. /settings/ui-flags) skips role check entirely', async () => {
    // Setup: pretend handler has SETTINGS_ACCESS_BYPASS metadata
    const handler = {};
    Reflect.defineMetadata(SETTINGS_ACCESS_BYPASS, true, handler);
    // SALES would normally be rejected — bypass marker means it passes
    await expect(
      guard.canActivate(makeContext({ role: 'SALES' }, handler, {})),
    ).resolves.toBe(true);
    // DB should NOT even be queried
    expect(prisma.systemConfig.findFirst).not.toHaveBeenCalled();
  });
});
