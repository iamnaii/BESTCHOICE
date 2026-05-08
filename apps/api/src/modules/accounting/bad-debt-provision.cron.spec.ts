import { Test, TestingModule } from '@nestjs/testing';
import { BadDebtProvisionCron } from './bad-debt-provision.cron';
import { BadDebtService } from './bad-debt.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

/**
 * Wave 4 Task 1 — automated provision cron tests.
 *
 * Verifies:
 *  - happy path: SYSTEM user resolved, calculateProvisions called, period
 *    is the prior month (YYYY-MM)
 *  - resilience: errors are sent to Sentry but cron does not throw
 *  - guard: missing SYSTEM user → Sentry alarm + early return (no crash)
 */
describe('BadDebtProvisionCron (Wave 4 T1)', () => {
  let cron: BadDebtProvisionCron;
  let badDebtService: { calculateProvisions: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();

    badDebtService = {
      calculateProvisions: jest.fn().mockResolvedValue({
        created: 5,
        totalProvision: 12345.67,
        byBucket: { '31-60': { count: 2, amount: 1000 } },
      }),
    };

    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'system-user-uuid' }),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BadDebtProvisionCron,
        { provide: BadDebtService, useValue: badDebtService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    cron = mod.get(BadDebtProvisionCron);
  });

  it('calls calculateProvisions with SYSTEM user id', async () => {
    const result = await cron.run();

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { isSystemUser: true },
      select: { id: true },
    });
    expect(badDebtService.calculateProvisions).toHaveBeenCalledTimes(1);
    expect(badDebtService.calculateProvisions).toHaveBeenCalledWith('system-user-uuid');

    expect(result).not.toBeNull();
    expect(result!.created).toBe(5);
    expect(result!.totalProvision).toBe(12345.67);
    // period must be YYYY-MM format
    expect(result!.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('reports prior month (not current) as the period', async () => {
    const result = await cron.run();
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const expected = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    expect(result!.period).toBe(expected);
  });

  it('emits Sentry info message on success', async () => {
    await cron.run();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('BadDebtProvisionCron'),
      expect.objectContaining({ level: 'info' }),
    );
  });

  it('captures errors to Sentry without crashing (resolves to null)', async () => {
    badDebtService.calculateProvisions.mockRejectedValueOnce(new Error('DB down'));
    await expect(cron.run()).resolves.toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ cron: 'bad-debt-provision' }),
      }),
    );
  });

  it('alarms Sentry and aborts when SYSTEM user is missing (no calculateProvisions call)', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null);
    const result = await cron.run();
    expect(result).toBeNull();
    expect(badDebtService.calculateProvisions).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('SYSTEM user not found'),
      expect.objectContaining({ level: 'error' }),
    );
  });
});
