import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ExportEnabledGuard } from './export-enabled.guard';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * D1.3.3.1 — server-side export gate.
 *
 * The guard reads SystemConfig key `export_enabled` and throws ForbiddenException
 * when set to "false". Default (missing key, transient errors) is to allow.
 */
describe('ExportEnabledGuard (D1.3.3.1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let guard: ExportEnabledGuard;

  const ctx = {} as ExecutionContext;

  beforeEach(() => {
    prisma = {
      systemConfig: {
        findFirst: jest.fn(),
      },
    };
    guard = new ExportEnabledGuard(prisma as PrismaService);
  });

  it('allows when SystemConfig row is absent (default true)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows when SystemConfig value is "true"', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws ForbiddenException when SystemConfig value is "false"', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when value is "0" (truthy/falsy form)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: '0' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows on transient DB read failure (graceful default)', async () => {
    prisma.systemConfig.findFirst.mockRejectedValue(new Error('DB down'));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
