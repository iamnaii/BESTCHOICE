import * as Sentry from '@sentry/nestjs';
import { RecurringBillsCron } from '../crons/recurring-bills.cron';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

describe('RecurringBillsCron', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  let cron: RecurringBillsCron;
  const RESULT = { disabled: false, templates: 1, created: 1, skippedMissed: 0, paid: 0, reverted: 0, unpostedClosed: 0, reminded: 0, repaired: 0, failed: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) };
    prisma = { $transaction: jest.fn().mockImplementation((cb: (t: unknown) => Promise<unknown>) => cb(tx)) };
    service = { runDaily: jest.fn().mockResolvedValue(RESULT) };
    cron = new RecurringBillsCron(prisma, service);
  });

  it('takes the transaction-scoped advisory lock then runs the daily pass (lock released with the transaction)', async () => {
    const res = await cron.tick();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(String(tx.$queryRaw.mock.calls[0][0])).toContain('pg_try_advisory_xact_lock');
    expect(service.runDaily).toHaveBeenCalledTimes(1);
    expect(res).toEqual(RESULT);
  });

  it('another instance holds the lock → logs and exits without running (Cloud Run runs the scheduler on every instance)', async () => {
    tx.$queryRaw.mockResolvedValue([{ locked: false }]);
    const res = await cron.tick();
    expect(service.runDaily).not.toHaveBeenCalled();
    expect(res).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('runDaily throwing is captured and never escapes the scheduler', async () => {
    service.runDaily.mockRejectedValue(new Error('db down'));
    await expect(cron.tick()).resolves.toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: expect.objectContaining({ cron: 'recurring-bills' }) }));
  });
});
