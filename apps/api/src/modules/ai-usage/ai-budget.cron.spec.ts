import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AiBudgetCron } from './ai-budget.cron';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('AiBudgetCron.checkDailyBudget', () => {
  let cron: AiBudgetCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: any;

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();
    prisma = {
      aiUsageLog: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    config = { get: jest.fn().mockReturnValue('10') };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AiBudgetCron,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    cron = mod.get(AiBudgetCron);
  });

  it('returns 0 breach when no usage', async () => {
    const result = await cron.checkDailyBudget();
    expect(result.totalUsd).toBe(0);
    expect(result.breached).toBe(false);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('alerts warning when spend >= 80% of budget but not yet breached', async () => {
    prisma.aiUsageLog.groupBy.mockResolvedValue([
      { service: 'finance-ai', _sum: { costUsd: new Prisma.Decimal('8.5') } },
    ]);
    await cron.checkDailyBudget();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('of $10'),
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('alerts error when spend > budget', async () => {
    prisma.aiUsageLog.groupBy.mockResolvedValue([
      { service: 'finance-ai', _sum: { costUsd: new Prisma.Decimal('7.5') } },
      { service: 'vision-slip', _sum: { costUsd: new Prisma.Decimal('3.5') } },
    ]);
    const result = await cron.checkDailyBudget();
    expect(result.breached).toBe(true);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('breached'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('uses default budget $10 when env var missing', async () => {
    config.get.mockReturnValue(undefined);
    prisma.aiUsageLog.groupBy.mockResolvedValue([
      { service: 'finance-ai', _sum: { costUsd: new Prisma.Decimal('11') } },
    ]);
    const result = await cron.checkDailyBudget();
    expect(result.breached).toBe(true);
  });

  it('captures exception on DB failure (no throw)', async () => {
    prisma.aiUsageLog.groupBy.mockRejectedValue(new Error('db error'));
    const result = await cron.checkDailyBudget();
    expect(result.totalUsd).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
