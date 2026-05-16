import { DraftAlertsCron } from '../crons/draft-alerts.cron';

describe('DraftAlertsCron — D1.3.1.1', () => {
  let cron: DraftAlertsCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const FIXED_NOW = new Date('2026-05-17T09:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW });
    prisma = {
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      expenseDocument: { findMany: jest.fn().mockResolvedValue([]) },
      notificationLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
    };
    cron = new DraftAlertsCron(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('skips silently when feature flag is disabled (default off)', async () => {
    // No SystemConfig row → readBoolFlag returns default `false` → cron exits
    const result = await cron.tick();
    expect(result).toEqual({ enabled: false, alerted: 0, skipped: 0, failed: 0 });
    expect(prisma.expenseDocument.findMany).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });

  it('sends in-app alert when DRAFT older than threshold + flag enabled', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'draft_alerts_enabled') return Promise.resolve({ value: 'true' });
        if (args.where.key === 'draft_alert_threshold_days') return Promise.resolve({ value: '7' });
        return Promise.resolve(null);
      },
    );
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        number: 'EX-20260510-0001',
        createdById: 'u-1',
        documentType: 'EXPENSE',
        createdAt: new Date('2026-05-08T00:00:00.000Z'),
        createdBy: { email: 'creator@example.com', name: 'Creator' },
      },
    ]);

    const result = await cron.tick();

    expect(result.enabled).toBe(true);
    expect(result.alerted).toBe(1);
    expect(prisma.notificationLog.create).toHaveBeenCalledTimes(1);
    const call = prisma.notificationLog.create.mock.calls[0][0];
    expect(call.data.channel).toBe('IN_APP');
    expect(call.data.subject).toBe('เอกสารฉบับร่างค้าง');
    expect(call.data.message).toMatch(/EX-20260510-0001/);
    expect(call.data.message).toMatch(/7\+ วัน/);
    expect(call.data.relatedId).toBe('doc-1');
    expect(call.data.recipient).toBe('creator@example.com');
  });

  it('respects configurable threshold via SystemConfig', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'draft_alerts_enabled') return Promise.resolve({ value: 'true' });
        if (args.where.key === 'draft_alert_threshold_days') return Promise.resolve({ value: '3' });
        return Promise.resolve(null);
      },
    );
    prisma.expenseDocument.findMany.mockResolvedValue([]);

    await cron.tick();

    // The findMany cutoff arg must be derived from threshold=3 days
    const findManyCall = prisma.expenseDocument.findMany.mock.calls[0][0];
    const cutoff: Date = findManyCall.where.createdAt.lte;
    const threeDaysAgo = new Date(FIXED_NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
    expect(cutoff.toISOString()).toBe(threeDaysAgo.toISOString());
  });

  it('dedups against alerts already sent today (idempotent)', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'draft_alerts_enabled') return Promise.resolve({ value: 'true' });
        return Promise.resolve(null);
      },
    );
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        number: 'EX-X',
        createdById: 'u-1',
        documentType: 'EXPENSE',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        createdBy: { email: 'a@b.com', name: 'A' },
      },
    ]);
    // Already alerted today
    prisma.notificationLog.findFirst.mockResolvedValue({ id: 'existing-log' });

    const result = await cron.tick();

    expect(result.alerted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });
});
