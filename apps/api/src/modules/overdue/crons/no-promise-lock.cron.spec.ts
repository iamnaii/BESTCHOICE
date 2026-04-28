import { Test } from '@nestjs/testing';
import { NoPromiseLockCron } from './no-promise-lock.cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { MdmLockService } from '../mdm-lock.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('NoPromiseLockCron', () => {
  let cron: NoPromiseLockCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let mdm: any;

  beforeEach(async () => {
    prisma = {
      contract: { findMany: jest.fn() },
      callLog: { findMany: jest.fn() },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'sys-uid' }) },
    };
    mdm = { autoLock: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        NoPromiseLockCron,
        { provide: PrismaService, useValue: prisma },
        { provide: MdmLockService, useValue: mdm },
      ],
    }).compile();
    cron = module.get(NoPromiseLockCron);
  });

  it('locks when last 2 callLogs are NO_ANSWER/UNREACHABLE consecutively', async () => {
    prisma.contract.findMany.mockResolvedValue([{ id: 'c-1', deviceLocked: false }]);
    prisma.callLog.findMany.mockResolvedValue([
      { id: 'cl-2', result: 'NO_ANSWER', createdAt: new Date('2026-04-26') },
      { id: 'cl-1', result: 'UNREACHABLE', createdAt: new Date('2026-04-25') },
    ]);

    await cron.handleHourly();

    expect(mdm.autoLock).toHaveBeenCalledWith(
      'c-1',
      expect.stringContaining('NO_PROMISE'),
      expect.anything(),
    );
  });

  it('does NOT lock if streak broken by other result', async () => {
    prisma.contract.findMany.mockResolvedValue([{ id: 'c-1', deviceLocked: false }]);
    prisma.callLog.findMany.mockResolvedValue([
      { id: 'cl-2', result: 'NO_ANSWER', createdAt: new Date('2026-04-26') },
      { id: 'cl-1', result: 'PROMISED', createdAt: new Date('2026-04-20') },
    ]);

    await cron.handleHourly();

    expect(mdm.autoLock).not.toHaveBeenCalled();
  });

  it('skips already-locked contracts (filtered by query)', async () => {
    prisma.contract.findMany.mockResolvedValue([]);

    await cron.handleHourly();

    expect(mdm.autoLock).not.toHaveBeenCalled();
  });
});
