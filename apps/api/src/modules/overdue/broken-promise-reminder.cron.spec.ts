import { Test, TestingModule } from '@nestjs/testing';
import { BrokenPromiseReminderCron } from './broken-promise-reminder.cron';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('BrokenPromiseReminderCron.runDaily', () => {
  let cron: BrokenPromiseReminderCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();

    prisma = {
      dunningRule: {
        findUnique: jest.fn().mockResolvedValue({ id: 'dunning-event-PROMISE_DUE_REMINDER' }),
      },
      callLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      dunningAction: {
        create: jest.fn().mockResolvedValue({ id: 'da-1' }),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BrokenPromiseReminderCron,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    cron = mod.get(BrokenPromiseReminderCron);
  });

  it('returns 0 suggested when no candidates', async () => {
    const result = await cron.runDaily();
    expect(result.suggested).toBe(0);
    expect(prisma.dunningAction.create).not.toHaveBeenCalled();
  });

  it('aborts cleanly + reports to Sentry when system rule is missing', async () => {
    prisma.dunningRule.findUnique.mockResolvedValueOnce(null);

    const result = await cron.runDaily();

    expect(result).toEqual({ suggested: 0, skipped: 0 });
    expect(prisma.callLog.findMany).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing system DunningRule'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('queries PROMISED + brokenAt null + settlementDate within today + contract OVERDUE/DEFAULT', async () => {
    await cron.runDaily();

    const where = prisma.callLog.findMany.mock.calls[0][0].where;
    expect(where.result).toBe('PROMISED');
    expect(where.brokenAt).toBeNull();
    expect(where.deletedAt).toBeNull();
    expect(where.settlementDate.gte).toBeInstanceOf(Date);
    expect(where.settlementDate.lt).toBeInstanceOf(Date);
    // 24h window
    const span =
      (where.settlementDate.lt as Date).getTime() -
      (where.settlementDate.gte as Date).getTime();
    expect(span).toBe(24 * 60 * 60 * 1000);
    expect(where.contract.status.in).toEqual(['OVERDUE', 'DEFAULT']);
    expect(where.contract.deletedAt).toBeNull();
  });

  it('creates one DunningAction per unique contract (dedup multiple call logs)', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      {
        id: 'cl-1',
        contractId: 'c-1',
        settlementDate: new Date('2026-04-25T08:00:00.000Z'),
        contract: { payments: [{ id: 'p-1' }] },
      },
      {
        id: 'cl-2',
        contractId: 'c-1', // duplicate contract → skipped
        settlementDate: new Date('2026-04-25T09:00:00.000Z'),
        contract: { payments: [{ id: 'p-1' }] },
      },
      {
        id: 'cl-3',
        contractId: 'c-2',
        settlementDate: new Date('2026-04-25T10:00:00.000Z'),
        contract: { payments: [{ id: 'p-2' }] },
      },
    ]);

    const result = await cron.runDaily();

    expect(result.suggested).toBe(2);
    expect(result.skipped).toBe(1);
    expect(prisma.dunningAction.create).toHaveBeenCalledTimes(2);

    const c1Args = prisma.dunningAction.create.mock.calls[0][0].data;
    expect(c1Args.dunningRuleId).toBe('dunning-event-PROMISE_DUE_REMINDER');
    expect(c1Args.contractId).toBe('c-1');
    expect(c1Args.paymentId).toBe('p-1');
    expect(c1Args.channel).toBe('INTERNAL_ALERT');
    expect(c1Args.status).toBe('PENDING');
  });

  it('treats P2002 unique conflict as idempotent skip (does NOT alarm Sentry)', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      {
        id: 'cl-1',
        contractId: 'c-1',
        settlementDate: new Date('2026-04-25T08:00:00.000Z'),
        contract: { payments: [{ id: 'p-1' }] },
      },
    ]);
    const conflict = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    prisma.dunningAction.create.mockRejectedValueOnce(conflict);

    const result = await cron.runDaily();

    expect(result.suggested).toBe(0);
    expect(result.skipped).toBe(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('forwards non-P2002 create failure to Sentry but continues other contracts', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      {
        id: 'cl-1',
        contractId: 'c-1',
        settlementDate: new Date('2026-04-25T08:00:00.000Z'),
        contract: { payments: [{ id: 'p-1' }] },
      },
      {
        id: 'cl-2',
        contractId: 'c-2',
        settlementDate: new Date('2026-04-25T09:00:00.000Z'),
        contract: { payments: [{ id: 'p-2' }] },
      },
    ]);
    prisma.dunningAction.create
      .mockRejectedValueOnce(new Error('FK violation'))
      .mockResolvedValueOnce({ id: 'da-2' });

    const result = await cron.runDaily();

    expect(result.suggested).toBe(1);
    expect(result.skipped).toBe(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ step: 'createAction' }),
      }),
    );
  });

  it('captures top-level exception (does NOT throw) on DB failure', async () => {
    prisma.callLog.findMany.mockRejectedValue(new Error('db down'));

    const result = await cron.runDaily();

    expect(result).toEqual({ suggested: 0, skipped: 0 });
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ cron: 'broken-promise-reminder' }),
      }),
    );
  });

  it('survives candidates without an oldest-unpaid payment (paymentId null)', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      {
        id: 'cl-1',
        contractId: 'c-1',
        settlementDate: new Date('2026-04-25T08:00:00.000Z'),
        contract: { payments: [] },
      },
    ]);

    const result = await cron.runDaily();

    expect(result.suggested).toBe(1);
    const args = prisma.dunningAction.create.mock.calls[0][0].data;
    expect(args.paymentId).toBeNull();
  });
});
