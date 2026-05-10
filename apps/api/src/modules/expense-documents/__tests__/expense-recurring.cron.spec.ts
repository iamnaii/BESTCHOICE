import { ExpenseRecurringCron } from '../crons/expense-recurring.cron';

// Pin "today" so neither the production code (Intl en-CA) nor the spec fixtures
// (which used to read live `new Date().getDate()`) drift across the day boundary
// on UTC CI. Mid-day BKK = Mon 12:00 BKK = Mon 05:00 UTC.
const FIXED_NOW = new Date('2026-05-10T05:00:00.000Z');
// Derive day-of-month in Asia/Bangkok from FIXED_NOW so the constant cannot
// drift if FIXED_NOW is ever updated without keeping the day in sync.
const FIXED_BKK_DAY = parseInt(
  FIXED_NOW.toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
  }),
  10,
);

describe('ExpenseRecurringCron', () => {
  let cron: ExpenseRecurringCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let templatesService: any;

  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW });
    prisma = {
      expenseTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findFirst: jest.fn() },
      expenseDocument: { findFirst: jest.fn() },
    };
    templatesService = { instantiate: jest.fn() };
    cron = new ExpenseRecurringCron(prisma, templatesService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('skips silently when no recurring templates due today', async () => {
    prisma.expenseTemplate.findMany.mockResolvedValue([]);
    const result = await cron.tick();
    expect(result).toEqual({ processed: 0, failed: 0, skipped: 0 });
    expect(templatesService.instantiate).not.toHaveBeenCalled();
  });

  it('aborts when SYSTEM user not found', async () => {
    prisma.expenseTemplate.findMany.mockResolvedValue([
      { id: 't1', branchId: 'b1', isRecurring: true, recurringDay: FIXED_BKK_DAY },
    ]);
    prisma.user.findFirst.mockResolvedValue(null);
    const result = await cron.tick();
    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(templatesService.instantiate).not.toHaveBeenCalled();
  });

  it('skips templates already instantiated today (idempotent)', async () => {
    prisma.expenseTemplate.findMany.mockResolvedValue([
      { id: 't1', branchId: 'b1', isRecurring: true, recurringDay: FIXED_BKK_DAY },
    ]);
    prisma.user.findFirst.mockResolvedValue({ id: 'sys', branchId: 'b1', role: 'OWNER' });
    prisma.expenseDocument.findFirst.mockResolvedValue({ id: 'existing-doc' });
    const result = await cron.tick();
    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(templatesService.instantiate).not.toHaveBeenCalled();
  });

  it('instantiates templates that have not been processed today', async () => {
    prisma.expenseTemplate.findMany.mockResolvedValue([
      { id: 't1', branchId: 'b1', isRecurring: true, recurringDay: FIXED_BKK_DAY },
    ]);
    prisma.user.findFirst.mockResolvedValue({ id: 'sys', branchId: 'b1', role: 'OWNER' });
    prisma.expenseDocument.findFirst.mockResolvedValue(null);
    const result = await cron.tick();
    expect(result.processed).toBe(1);
    expect(templatesService.instantiate).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ id: 'sys' }),
      expect.objectContaining({ documentDate: expect.any(Date) }),
    );
  });

  it('captures failures + continues batch', async () => {
    prisma.expenseTemplate.findMany.mockResolvedValue([
      { id: 't1', branchId: 'b1', isRecurring: true, recurringDay: FIXED_BKK_DAY },
      { id: 't2', branchId: 'b1', isRecurring: true, recurringDay: FIXED_BKK_DAY },
    ]);
    prisma.user.findFirst.mockResolvedValue({ id: 'sys', branchId: 'b1', role: 'OWNER' });
    prisma.expenseDocument.findFirst.mockResolvedValue(null);
    templatesService.instantiate
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'doc-2' });
    const result = await cron.tick();
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(1);
  });
});
