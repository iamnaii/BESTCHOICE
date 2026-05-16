import { ExpenseDocumentsService } from '../expense-documents.service';
import { LineAggregatorService } from '../services/line-aggregator.service';

describe('ExpenseDocumentsService.create — multi-line', () => {
  let service: ExpenseDocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let aggregator: LineAggregatorService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      expenseDocument: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'doc-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      expenseDetail: { update: jest.fn() },
      expenseLine: { deleteMany: jest.fn() },
      chartOfAccount: {
        findMany: jest.fn().mockResolvedValue([
          { code: '53-1101', type: 'ค่าใช้จ่าย' },
          { code: '53-1404', type: 'ค่าใช้จ่าย' },
        ]),
      },
    };
    aggregator = new LineAggregatorService();
    service = new ExpenseDocumentsService(
      prisma,
      { next: jest.fn().mockResolvedValue('EX-20260511-0001') } as never,
      { assertCanPost: jest.fn(), assertCanVoid: jest.fn(), assertCanEdit: jest.fn(), resolveTargetStatus: jest.fn().mockReturnValue('POSTED') } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { createAndPost: jest.fn() } as never,
      aggregator,
      { preview: jest.fn() } as never,
      { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never,
      { getConfig: jest.fn(), validate: jest.fn() } as never,
      { loadWhitelist: jest.fn().mockResolvedValue(new Set()), validateLine: jest.fn() } as never,
    );
  });

  it('aggregates 3 lines into document totals', async () => {
    await service.create({
      documentType: 'EXPENSE',
      branchId: 'b1',
      documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      lines: [
        { category: '53-1101', quantity: 1, unitPrice: 5000, vatPercent: 7, whtPercent: 0 },
        { category: '53-1404', quantity: 1, unitPrice: 1500, vatPercent: 7, whtPercent: 0 },
        { category: '53-1101', quantity: 1, unitPrice: 500,  vatPercent: 0, whtPercent: 0 },
      ],
    } as never, 'user-1');

    const callArg = prisma.expenseDocument.create.mock.calls[0][0];
    // subtotal = 5000 + 1500 + 500 = 7000
    expect(callArg.data.subtotal.toFixed(2)).toBe('7000.00');
    // vat = (5000 + 1500) × 7% = 455
    expect(callArg.data.vatAmount.toFixed(2)).toBe('455.00');
    // total = 7000 + 455 = 7455
    expect(callArg.data.totalAmount.toFixed(2)).toBe('7455.00');
  });

  it('rejects when ANY line has missing CoA code', async () => {
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([{ code: '53-1101', type: 'ค่าใช้จ่าย' }]);
    await expect(service.create({
      documentType: 'EXPENSE',
      branchId: 'b1',
      documentDate: '2026-05-11',
      lines: [
        { category: '53-1101', quantity: 1, unitPrice: 100, vatPercent: 7, whtPercent: 0 },
        { category: '53-9999', quantity: 1, unitPrice: 100, vatPercent: 7, whtPercent: 0 },
      ],
    } as never, 'user-1')).rejects.toThrow(/53-9999.*ไม่พบ/);
  });
});
