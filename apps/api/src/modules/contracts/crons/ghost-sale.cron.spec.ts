import { Test, TestingModule } from '@nestjs/testing';
import { GhostSaleCron } from './ghost-sale.cron';
import { PrismaService } from '../../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('GhostSaleCron.scan', () => {
  let cron: GhostSaleCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();

    prisma = {
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [GhostSaleCron, { provide: PrismaService, useValue: prisma }],
    }).compile();
    cron = mod.get(GhostSaleCron);
  });

  it('returns 0/0 when no suspicious contracts', async () => {
    const result = await cron.scan();
    expect(result.ghost).toBe(0);
    expect(result.rapidVoid).toBe(0);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('ghost query: ACTIVE + age > 7d + no paid payments', async () => {
    await cron.scan();
    const ghostArgs = prisma.contract.findMany.mock.calls[0][0];
    expect(ghostArgs.where.status).toBe('ACTIVE');
    expect(ghostArgs.where.deletedAt).toBeNull();
    expect(ghostArgs.where.payments.none.status.in).toContain('PAID');
    const age = Date.now() - (ghostArgs.where.createdAt.lt as Date).getTime();
    const days = age / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('rapid-void query: deletedAt within 30d of creation', async () => {
    await cron.scan();
    const voidArgs = prisma.contract.findMany.mock.calls[1][0];
    expect(voidArgs.where.deletedAt.gte).toBeInstanceOf(Date);
    expect(voidArgs.where.createdAt.gte).toBeInstanceOf(Date);
  });

  it('alerts Sentry with per-branch breakdown for ghost contracts', async () => {
    prisma.contract.findMany
      .mockResolvedValueOnce([
        { id: 'c-1', contractNumber: 'A', branchId: 'b-1', salespersonId: 's-1', createdAt: new Date() },
        { id: 'c-2', contractNumber: 'B', branchId: 'b-1', salespersonId: 's-2', createdAt: new Date() },
        { id: 'c-3', contractNumber: 'C', branchId: 'b-2', salespersonId: 's-3', createdAt: new Date() },
      ])
      .mockResolvedValueOnce([]);

    const result = await cron.scan();
    expect(result.ghost).toBe(3);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('Ghost sale detection: 3'),
      expect.objectContaining({ level: 'warning' }),
    );
    const call = (Sentry.captureMessage as jest.Mock).mock.calls[0][1];
    expect(call.extra.byBranch).toEqual({ 'b-1': 2, 'b-2': 1 });
  });

  it('alerts Sentry for rapid voids with per-salesperson breakdown', async () => {
    prisma.contract.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'c-1', contractNumber: 'X', branchId: 'b-1', salespersonId: 's-1', createdAt: new Date(), deletedAt: new Date() },
        { id: 'c-2', contractNumber: 'Y', branchId: 'b-1', salespersonId: 's-1', createdAt: new Date(), deletedAt: new Date() },
      ]);

    const result = await cron.scan();
    expect(result.rapidVoid).toBe(2);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('Rapid void pattern'),
      expect.any(Object),
    );
    const call = (Sentry.captureMessage as jest.Mock).mock.calls[0][1];
    expect(call.extra.bySales).toEqual({ 's-1': 2 });
  });

  it('swallows DB failure (no throw)', async () => {
    prisma.contract.findMany.mockRejectedValue(new Error('db down'));
    const result = await cron.scan();
    expect(result.ghost).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
