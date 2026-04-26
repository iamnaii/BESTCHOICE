import { Test, TestingModule } from '@nestjs/testing';
import { BrokenPromiseCron } from './broken-promise.cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { DunningEngineService } from '../dunning-engine.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('BrokenPromiseCron.flagBrokenPromises', () => {
  let cron: BrokenPromiseCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let dunningEngine: { executeEventTrigger: jest.Mock };

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();

    prisma = {
      callLog: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sys-user' }),
      },
      auditLog: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    dunningEngine = { executeEventTrigger: jest.fn().mockResolvedValue(undefined) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BrokenPromiseCron,
        { provide: PrismaService, useValue: prisma },
        { provide: DunningEngineService, useValue: dunningEngine },
      ],
    }).compile();
    cron = mod.get(BrokenPromiseCron);
  });

  it('flags 0 when no candidates', async () => {
    const result = await cron.flagBrokenPromises();
    expect(result.flagged).toBe(0);
    expect(prisma.callLog.updateMany).not.toHaveBeenCalled();
  });

  it('only matches PROMISED + settlementDate in past + brokenAt null + contract OVERDUE/DEFAULT', async () => {
    await cron.flagBrokenPromises();
    const where = prisma.callLog.findMany.mock.calls[0][0].where;
    expect(where.result).toBe('PROMISED');
    expect(where.brokenAt).toBeNull();
    expect(where.settlementDate.lt).toBeInstanceOf(Date);
    expect(where.contract.status.in).toContain('OVERDUE');
    expect(where.contract.status.in).toContain('DEFAULT');
  });

  it('sets brokenAt on matched call logs and reports count', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      { id: 'cl-1', contractId: 'c-1', settlementDate: new Date('2026-04-10') },
      { id: 'cl-2', contractId: 'c-2', settlementDate: new Date('2026-04-12') },
    ]);

    const result = await cron.flagBrokenPromises();

    expect(result.flagged).toBe(2);
    const updateArgs = prisma.callLog.updateMany.mock.calls[0][0];
    expect(updateArgs.where.id.in).toEqual(['cl-1', 'cl-2']);
    expect(updateArgs.data.brokenAt).toBeInstanceOf(Date);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('Broken-promise cron flagged 2'),
      expect.objectContaining({
        tags: expect.objectContaining({ cron: 'broken-promise' }),
      }),
    );
  });

  it('captures exception on DB failure (does NOT throw)', async () => {
    prisma.callLog.findMany.mockRejectedValue(new Error('db down'));

    const result = await cron.flagBrokenPromises();

    expect(result.flagged).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ cron: 'broken-promise' }) }),
    );
  });

  it('fires BROKEN_PROMISE event for each unique contract', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      { id: 'cl-1', contractId: 'c-1', settlementDate: new Date('2026-04-10') },
      { id: 'cl-2', contractId: 'c-1', settlementDate: new Date('2026-04-12') },
      { id: 'cl-3', contractId: 'c-2', settlementDate: new Date('2026-04-14') },
    ]);

    await cron.flagBrokenPromises();

    // 3 call logs across 2 contracts → 2 event fires (dedup by contractId at cron level)
    expect(dunningEngine.executeEventTrigger).toHaveBeenCalledTimes(2);
    expect(dunningEngine.executeEventTrigger).toHaveBeenCalledWith('BROKEN_PROMISE', 'c-1', null, null);
    expect(dunningEngine.executeEventTrigger).toHaveBeenCalledWith('BROKEN_PROMISE', 'c-2', null, null);
  });

  it('event trigger failure does NOT abort the flag — brokenAt still set', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      { id: 'cl-1', contractId: 'c-1', settlementDate: new Date('2026-04-10') },
    ]);
    dunningEngine.executeEventTrigger.mockRejectedValueOnce(new Error('line api down'));

    const result = await cron.flagBrokenPromises();

    expect(result.flagged).toBe(1);
    expect(prisma.callLog.updateMany).toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ step: 'executeEventTrigger' }) }),
    );
  });
});
