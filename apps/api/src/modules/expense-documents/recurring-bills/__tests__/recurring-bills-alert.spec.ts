import { computeRecurringBillsAlert } from '../recurring-bills-alert';

const NOW = new Date('2026-10-26T01:05:00.000Z');
const bkkMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d) - 7 * 3600_000);

describe('computeRecurringBillsAlert (การ์ดแดชบอร์ด — spec §8)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  beforeEach(() => {
    prisma = {
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      recurringBillOccurrence: { findMany: jest.fn().mockResolvedValue([]) },
    };
  });

  it('no pending bills within 3 days → no card', async () => {
    expect(await computeRecurringBillsAlert(prisma, NOW)).toBeNull();
    expect(prisma.recurringBillOccurrence.findMany.mock.calls[0][0].where).toMatchObject({ status: 'PENDING', dueDate: { lte: bkkMidnight(2026, 10, 29) } });
  });
  it('two due within 3 days → warning, count 2', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([{ dueDate: bkkMidnight(2026, 10, 29) }, { dueDate: bkkMidnight(2026, 10, 27) }]);
    expect(await computeRecurringBillsAlert(prisma, NOW)).toEqual({
      type: 'recurring_bills_due', severity: 'warning', message: 'บิลประจำ 2 รายการครบกำหนดใน 3 วัน', link: '/expenses/recurring-bills', count: 2,
    });
  });
  it('one overdue + due today + due in 3 days → critical, count 3, message names the overdue', async () => {
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([{ dueDate: bkkMidnight(2026, 10, 24) }, { dueDate: bkkMidnight(2026, 10, 26) }, { dueDate: bkkMidnight(2026, 10, 29) }]);
    expect(await computeRecurringBillsAlert(prisma, NOW)).toEqual({
      type: 'recurring_bills_due', severity: 'critical', message: 'บิลประจำ 3 รายการครบกำหนดใน 3 วัน · เกินกำหนด 1', link: '/expenses/recurring-bills', count: 3,
    });
  });
  it('branch filter goes through the template; templates flag off → no card', async () => {
    await computeRecurringBillsAlert(prisma, NOW, 'br-1');
    expect(prisma.recurringBillOccurrence.findMany.mock.calls[0][0].where).toMatchObject({ template: { branchId: 'br-1' } });
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
    prisma.recurringBillOccurrence.findMany.mockResolvedValue([{ dueDate: bkkMidnight(2026, 10, 24) }]);
    expect(await computeRecurringBillsAlert(prisma, NOW)).toBeNull();
  });
});
