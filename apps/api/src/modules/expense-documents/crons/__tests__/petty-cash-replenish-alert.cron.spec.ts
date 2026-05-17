import { Decimal } from '@prisma/client/runtime/library';
import { PettyCashReplenishAlertCron } from '../petty-cash-replenish-alert.cron';

describe('PettyCashReplenishAlertCron', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;
  let cron: PettyCashReplenishAlertCron;

  beforeEach(() => {
    prisma = {
      systemConfig: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      expenseDocument: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: null } }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u-owner-1', email: 'owner1@bestchoice.test', name: 'Owner 1' },
        ]),
      },
    };
    notifications = {
      send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }),
    };
    cron = new PettyCashReplenishAlertCron(prisma, notifications);
  });

  it('sends 1 alert per OWNER when balance < threshold (defaults: limit 5000, threshold 5000, spent 100)', async () => {
    prisma.expenseDocument.aggregate.mockResolvedValue({
      _sum: { totalAmount: new Decimal('100.00') },
    });
    prisma.user.findMany.mockResolvedValue([
      { id: 'u-owner-1', email: 'owner1@bestchoice.test', name: 'Owner 1' },
      { id: 'u-owner-2', email: 'owner2@bestchoice.test', name: 'Owner 2' },
    ]);

    const result = await cron.tick();

    // balance = 5000 - 100 = 4900 < threshold 5000 → alert.
    expect(result.alertsSent).toBe(2);
    expect(result.balance).toBe(4900);
    expect(result.threshold).toBe(5000);
    expect(result.limit).toBe(5000);
    expect(notifications.send).toHaveBeenCalledTimes(2);
    const callArg = notifications.send.mock.calls[0][0];
    expect(callArg.channel).toBe('IN_APP');
    expect(callArg.message).toMatch(/ยอดเงินสดย่อยต่ำกว่าเกณฑ์/);
    expect(callArg.message).toMatch(/฿5,000/);
  });

  it('skips alert when balance >= threshold', async () => {
    // No spend yet — balance = 5000 = threshold (not strictly less).
    prisma.expenseDocument.aggregate.mockResolvedValue({
      _sum: { totalAmount: new Decimal('0') },
    });
    const result = await cron.tick();
    expect(result.alertsSent).toBe(0);
    expect(result.balance).toBe(5000);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('threshold=0 disables the alert entirely (kill switch)', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'petty_cash_replenish_threshold', value: '0' },
      { key: 'petty_cash_limit', value: '5000' },
    ]);
    // Even with full drain, no alert should fire.
    prisma.expenseDocument.aggregate.mockResolvedValue({
      _sum: { totalAmount: new Decimal('5000.00') },
    });
    const result = await cron.tick();
    expect(result.alertsSent).toBe(0);
    expect(result.threshold).toBe(0);
    expect(notifications.send).not.toHaveBeenCalled();
    // Aggregate is also short-circuited (we return before sum).
    expect(prisma.expenseDocument.aggregate).not.toHaveBeenCalled();
  });

  it('clamps absurd threshold values (negative → default 5000)', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'petty_cash_replenish_threshold', value: '-100' },
      { key: 'petty_cash_limit', value: '5000' },
    ]);
    prisma.expenseDocument.aggregate.mockResolvedValue({
      _sum: { totalAmount: new Decimal('4000.00') },
    });
    const result = await cron.tick();
    // -100 → clamped to 5000 → balance 1000 < 5000 → alert.
    expect(result.threshold).toBe(5000);
    expect(result.balance).toBe(1000);
    expect(result.alertsSent).toBe(1);
  });

  it('captures Sentry + returns zero counts when prisma throws (no scheduler crash)', async () => {
    prisma.systemConfig.findMany.mockRejectedValue(new Error('DB down'));
    const result = await cron.tick();
    expect(result.alertsSent).toBe(0);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('handles "no active OWNER" gracefully — logs warn, returns zero alerts', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.expenseDocument.aggregate.mockResolvedValue({
      _sum: { totalAmount: new Decimal('4500.00') },
    });
    const result = await cron.tick();
    expect(result.alertsSent).toBe(0);
    expect(result.balance).toBe(500);
    expect(notifications.send).not.toHaveBeenCalled();
  });
});
