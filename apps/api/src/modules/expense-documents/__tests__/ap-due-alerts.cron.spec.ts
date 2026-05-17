import { ApDueAlertsCron } from '../crons/ap-due-alerts.cron';

describe('ApDueAlertsCron — D1.3.1.2', () => {
  let cron: ApDueAlertsCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;

  const FIXED_NOW = new Date('2026-05-17T09:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW });
    prisma = {
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      expenseDocument: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notifications = {
      send: jest.fn().mockResolvedValue({ id: 'log-1', status: 'SENT' }),
    };
    cron = new ApDueAlertsCron(prisma, notifications);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('skips silently when feature flag is absent (default OFF)', async () => {
    // No SystemConfig rows → default `false` → cron exits without findMany.
    const result = await cron.tick();
    expect(result).toEqual({ enabled: false, alerted: 0, skipped: 0, failed: 0 });
    expect(prisma.expenseDocument.findMany).not.toHaveBeenCalled();
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('skips silently when feature flag is explicitly disabled', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'ap_due_alerts_enabled') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      },
    );
    const result = await cron.tick();
    expect(result).toEqual({ enabled: false, alerted: 0, skipped: 0, failed: 0 });
    expect(prisma.expenseDocument.findMany).not.toHaveBeenCalled();
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('runs when flag explicitly enabled', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'ap_due_alerts_enabled') return Promise.resolve({ value: 'true' });
        return Promise.resolve(null);
      },
    );
    const result = await cron.tick();
    expect(result.enabled).toBe(true);
    expect(prisma.expenseDocument.findMany).toHaveBeenCalled();
  });

  it('alerts approver via NotificationsService with vendor + amount + posted date', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'ap_due_alerts_enabled') return Promise.resolve({ value: 'true' });
        return Promise.resolve(null);
      },
    );
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        number: 'EX-20260514-0001',
        documentType: 'EXPENSE',
        documentDate: new Date('2026-05-10T00:00:00.000Z'),
        totalAmount: 5300,
        vendorName: 'บริษัท ตัวอย่าง จำกัด',
        approvedById: 'u-approver',
        createdById: 'u-creator',
        approvedBy: { email: 'approver@example.com', name: 'Approver' },
        createdBy: { email: 'creator@example.com', name: 'Creator' },
      },
    ]);

    const result = await cron.tick();

    expect(result.enabled).toBe(true);
    expect(result.alerted).toBe(1);
    expect(notifications.send).toHaveBeenCalledTimes(1);
    const callArg = notifications.send.mock.calls[0][0];
    expect(callArg.channel).toBe('IN_APP');
    expect(callArg.subject).toBe('แจ้งครบกำหนดชำระเจ้าหนี้');
    // Approver wins over creator
    expect(callArg.recipient).toBe('approver@example.com');
    expect(callArg.message).toMatch(/บริษัท ตัวอย่าง จำกัด/);
    expect(callArg.message).toMatch(/5,300\.00/);
    expect(callArg.message).toMatch(/2026-05-10/);
    expect(callArg.relatedId).toBe('doc-1');
  });

  it('counts SKIPPED when IN_APP master toggle is off (NotificationsService returns SKIPPED)', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'ap_due_alerts_enabled') return Promise.resolve({ value: 'true' });
        return Promise.resolve(null);
      },
    );
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        number: 'EX-X',
        documentType: 'EXPENSE',
        documentDate: new Date('2026-05-10T00:00:00.000Z'),
        totalAmount: 100,
        vendorName: null,
        approvedById: null,
        createdById: 'u-c',
        approvedBy: null,
        createdBy: { email: 'c@b.com', name: 'C' },
      },
    ]);
    notifications.send.mockResolvedValue({ id: '', status: 'SKIPPED', blockReason: 'IN_APP_DISABLED' });

    const result = await cron.tick();

    expect(result.alerted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('falls back to creator when no approver assigned', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'ap_due_alerts_enabled') return Promise.resolve({ value: 'true' });
        return Promise.resolve(null);
      },
    );
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        number: 'EX-X',
        documentType: 'EXPENSE',
        documentDate: new Date('2026-05-10T00:00:00.000Z'),
        totalAmount: 100,
        vendorName: null,
        approvedById: null,
        createdById: 'u-c',
        approvedBy: null,
        createdBy: { email: 'c@b.com', name: 'C' },
      },
    ]);

    await cron.tick();
    const callArg = notifications.send.mock.calls[0][0];
    expect(callArg.recipient).toBe('c@b.com');
    expect(callArg.message).toMatch(/เจ้าหนี้/); // default vendor label
  });

  it('respects configurable threshold via SystemConfig', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'ap_due_alerts_enabled') return Promise.resolve({ value: 'true' });
        if (args.where.key === 'ap_due_days_before') return Promise.resolve({ value: '7' });
        return Promise.resolve(null);
      },
    );
    await cron.tick();
    const findManyCall = prisma.expenseDocument.findMany.mock.calls[0][0];
    const cutoff: Date = findManyCall.where.documentDate.lte;
    const sevenDaysAgo = new Date(FIXED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(cutoff.toISOString()).toBe(sevenDaysAgo.toISOString());
  });

  it('captures outer findMany failures to Sentry and exits gracefully', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'ap_due_alerts_enabled') return Promise.resolve({ value: 'true' });
        return Promise.resolve(null);
      },
    );
    prisma.expenseDocument.findMany.mockRejectedValue(new Error('DB connection lost'));
    // Avoid noisy logger output
    const errorSpy = jest.spyOn(cron['logger'], 'error').mockImplementation(() => {});

    const result = await cron.tick();

    expect(result).toEqual({ enabled: false, alerted: 0, skipped: 0, failed: 0 });
    // Logger captured the outer failure
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Cron tick failed/));
    errorSpy.mockRestore();
  });
});
