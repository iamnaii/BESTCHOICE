import { Test, TestingModule } from '@nestjs/testing';
import { SnoozeCronService } from './snooze-cron.service';
import { PrismaService } from '../../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('SnoozeCronService.checkReminders', () => {
  let service: SnoozeCronService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    (Sentry.captureException as jest.Mock).mockClear();
    prisma = {
      chatSnooze: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [SnoozeCronService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(SnoozeCronService);
  });

  it('does nothing when no due reminders', async () => {
    await service.checkReminders();
    expect(prisma.chatSnooze.updateMany).not.toHaveBeenCalled();
  });

  it('marks due snoozes completed=true', async () => {
    prisma.chatSnooze.findMany.mockResolvedValue([
      { id: 's-1', roomId: 'r-1', staffId: 'u-1', note: 'follow up' },
      { id: 's-2', roomId: 'r-2', staffId: 'u-2', note: null },
    ]);
    await service.checkReminders();
    expect(prisma.chatSnooze.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s-1', 's-2'] } },
      data: { completed: true },
    });
  });

  it('query filters: remindAt <= now + completed=false', async () => {
    await service.checkReminders();
    const where = prisma.chatSnooze.findMany.mock.calls[0][0].where;
    expect(where.remindAt.lte).toBeInstanceOf(Date);
    expect(where.completed).toBe(false);
  });

  it('captures exception + does NOT throw when DB fails', async () => {
    prisma.chatSnooze.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.checkReminders()).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
