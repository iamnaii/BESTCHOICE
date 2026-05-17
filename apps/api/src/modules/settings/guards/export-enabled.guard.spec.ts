import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ExportEnabledGuard } from './export-enabled.guard';
import { PrismaService } from '../../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

/**
 * D1.3.3.1 — server-side export gate.
 *
 * The guard reads SystemConfig key `export_enabled`:
 *   - missing / "true" → allow
 *   - "false" / "0"    → ForbiddenException
 *   - DB read error    → fail-CLOSED (S1) — ForbiddenException
 *
 * Blocked attempts (S4) also write an EXPORT_BLOCKED AuditLog row.
 */
describe('ExportEnabledGuard (D1.3.3.1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let guard: ExportEnabledGuard;

  const makeCtx = (user?: { id: string }): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          ip: '203.0.113.10',
          method: 'GET',
          originalUrl: '/api/receipts/export',
          headers: {},
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      systemConfig: {
        findFirst: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    guard = new ExportEnabledGuard(prisma as PrismaService);
  });

  it('allows when SystemConfig row is absent (default true)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(makeCtx({ id: 'u1' }))).resolves.toBe(true);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('allows when SystemConfig value is "true"', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
    await expect(guard.canActivate(makeCtx({ id: 'u1' }))).resolves.toBe(true);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when SystemConfig value is "false" and writes EXPORT_BLOCKED audit', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
    await expect(guard.canActivate(makeCtx({ id: 'u1' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          action: 'EXPORT_BLOCKED',
          entity: 'system_config',
          entityId: 'export_enabled',
        }),
      }),
    );
  });

  it('throws ForbiddenException when value is "0" (falsy form)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: '0' });
    await expect(guard.canActivate(makeCtx({ id: 'u1' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  // S1 — fail-CLOSED on transient DB outage.
  it('fails CLOSED (403) on transient DB read failure', async () => {
    prisma.systemConfig.findFirst.mockRejectedValue(new Error('DB down'));
    await expect(guard.canActivate(makeCtx({ id: 'u1' }))).rejects.toThrow(
      ForbiddenException,
    );
    // Sentry captureException should have been called via mocked module.
    // We don't assert on its arg shape here — Sentry mock is module-scoped.
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'EXPORT_BLOCKED',
          newValue: expect.objectContaining({
            reason: expect.stringContaining('fail-closed'),
          }),
        }),
      }),
    );
  });

  it('skips audit write when user is missing (anonymous request)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
    await expect(guard.canActivate(makeCtx(undefined))).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('still throws 403 even when audit-log write fails (best-effort)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
    prisma.auditLog.create.mockRejectedValue(new Error('audit table down'));
    await expect(guard.canActivate(makeCtx({ id: 'u1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
