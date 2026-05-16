import { ApDueAlertsCron } from '../crons/ap-due-alerts.cron';

describe('ApDueAlertsCron — D1.3.1.2', () => {
  let cron: ApDueAlertsCron;
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
    cron = new ApDueAlertsCron(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('skips silently when feature flag is disabled', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      (args: { where: { key: string } }) => {
        if (args.where.key === 'ap_due_alerts_enabled') return Promise.resolve({ value: 'false' });
        return Promise.resolve(null);
      },
    );
    const result = await cron.tick();
    expect(result).toEqual({ enabled: false, alerted: 0, skipped: 0, failed: 0 });
    expect(prisma.expenseDocument.findMany).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });

  it('runs by default when flag absent (default = on)', async () => {
    // No systemConfig rows at all → default `true` → cron runs (no docs to find)
    const result = await cron.tick();
    expect(result.enabled).toBe(true);
    expect(prisma.expenseDocument.findMany).toHaveBeenCalled();
  });

  it('alerts approver with vendor + amount + posted date', async () => {
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
    const call = prisma.notificationLog.create.mock.calls[0][0];
    expect(call.data.channel).toBe('IN_APP');
    expect(call.data.subject).toBe('แจ้งครบกำหนดชำระเจ้าหนี้');
    // Approver wins over creator
    expect(call.data.recipient).toBe('approver@example.com');
    expect(call.data.message).toMatch(/บริษัท ตัวอย่าง จำกัด/);
    expect(call.data.message).toMatch(/5,300\.00/);
    expect(call.data.message).toMatch(/2026-05-10/);
    expect(call.data.relatedId).toBe('doc-1');
  });

  it('falls back to creator when no approver assigned', async () => {
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
    const call = prisma.notificationLog.create.mock.calls[0][0];
    expect(call.data.recipient).toBe('c@b.com');
    expect(call.data.message).toMatch(/เจ้าหนี้/); // default vendor label
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
});
