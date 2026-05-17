import { Decimal } from '@prisma/client/runtime/library';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { LineAggregatorService } from '../services/line-aggregator.service';

/**
 * Phase A.5 — Tax-disallowed expense flag.
 *
 * Verifies:
 *   1. create() persists doc-level `taxDisallowed` when provided
 *   2. create() persists per-line `taxDisallowed` on each line
 *   3. getTaxDisallowedSummary() splits doc-level vs line-level + grand total
 *   4. summary respects date range + branch filter (POSTED + non-deleted only)
 */
describe('ExpenseDocumentsService — tax-disallowed (Phase A.5)', () => {
  let service: ExpenseDocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let docNumber: any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      expenseDocument: {
        create: jest.fn().mockResolvedValue({ id: 'doc-1', number: 'EX-20260510-0001' }),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _sum: { totalAmount: null, amountBeforeVat: null },
        }),
      },
      expenseLine: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _sum: { amountBeforeVat: null },
        }),
      },
      chartOfAccount: {
        findMany: jest.fn().mockResolvedValue([
          { code: '53-1302', type: 'ค่าใช้จ่าย' },
          { code: '53-1404', type: 'ค่าใช้จ่าย' },
        ]),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
      companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'shop-co-id' }) },
      accountingPeriod: { findUnique: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      expenseDetail: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ lines: [] }),
      },
    };
    docNumber = { next: jest.fn().mockResolvedValue('EX-20260510-0001') };
    service = new ExpenseDocumentsService(
      prisma,
      docNumber,
      { assertCanPost: jest.fn(), assertCanVoid: jest.fn(), assertCanEdit: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { createAndPost: jest.fn() } as never,
      new LineAggregatorService(),
      { preview: jest.fn() } as never,
      { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never,
      { getConfig: jest.fn(), validate: jest.fn() } as never,
      { loadWhitelist: jest.fn().mockResolvedValue(new Set()), validateLine: jest.fn().mockResolvedValue({ taxableBase: new Decimal(0) }) } as never,
    );
  });

  describe('create() — persists tax-disallowed flag', () => {
    it('persists doc-level taxDisallowed=true when supplied', async () => {
      await service.create(
        {
          documentType: 'EXPENSE',
          branchId: 'branch-1',
          documentDate: '2026-05-10',
          priceType: 'EXCLUSIVE',
          taxDisallowed: true,
          lines: [
            { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
          ],
        } as never,
        'user-1',
      );
      const callArg = prisma.expenseDocument.create.mock.calls[0][0];
      expect(callArg.data.taxDisallowed).toBe(true);
    });

    it('defaults taxDisallowed=false when omitted (backwards compatible)', async () => {
      await service.create(
        {
          documentType: 'EXPENSE',
          branchId: 'branch-1',
          documentDate: '2026-05-10',
          priceType: 'EXCLUSIVE',
          lines: [
            { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
          ],
        } as never,
        'user-1',
      );
      const callArg = prisma.expenseDocument.create.mock.calls[0][0];
      expect(callArg.data.taxDisallowed).toBe(false);
    });

    it('persists per-line taxDisallowed override (line-level can mix true/false)', async () => {
      await service.create(
        {
          documentType: 'EXPENSE',
          branchId: 'branch-1',
          documentDate: '2026-05-10',
          priceType: 'EXCLUSIVE',
          taxDisallowed: false,
          lines: [
            { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 0, whtPercent: 0, taxDisallowed: true },
            { category: '53-1404', quantity: 1, unitPrice: 500, vatPercent: 0, whtPercent: 0 },
          ],
        } as never,
        'user-1',
      );
      const callArg = prisma.expenseDocument.create.mock.calls[0][0];
      const createdLines = callArg.data.expenseDetail.create.lines.create;
      expect(createdLines).toHaveLength(2);
      expect(createdLines[0].taxDisallowed).toBe(true);
      expect(createdLines[1].taxDisallowed).toBe(false);
    });
  });

  describe('getTaxDisallowedSummary()', () => {
    it('returns zero totals when no flagged docs in the period', async () => {
      const result = await service.getTaxDisallowedSummary({
        from: '2026-01-01',
        to: '2026-12-31',
      });
      expect(result.docLevelCount).toBe(0);
      expect(result.docLevelTotal).toBe('0.00');
      expect(result.lineLevelCount).toBe(0);
      expect(result.lineLevelTotal).toBe('0.00');
      expect(result.grandTotal).toBe('0.00');
    });

    it('sums doc-level totalAmount + line-level amountBeforeVat into grandTotal', async () => {
      prisma.expenseDocument.aggregate.mockResolvedValue({
        _count: { _all: 3 },
        _sum: { totalAmount: new Decimal('12345.67') },
      });
      prisma.expenseLine.aggregate.mockResolvedValue({
        _count: { _all: 2 },
        _sum: { amountBeforeVat: new Decimal('500.33') },
      });

      const result = await service.getTaxDisallowedSummary({
        from: '2026-01-01',
        to: '2026-12-31',
      });
      expect(result.docLevelCount).toBe(3);
      expect(result.docLevelTotal).toBe('12345.67');
      expect(result.lineLevelCount).toBe(2);
      expect(result.lineLevelTotal).toBe('500.33');
      // 12345.67 + 500.33 = 12846.00 exactly (Decimal arithmetic)
      expect(result.grandTotal).toBe('12846.00');
    });

    it('passes date range + branch filter into the doc-level query (POSTED only, no deleted)', async () => {
      await service.getTaxDisallowedSummary({
        branchId: 'b1',
        from: '2026-05-01',
        to: '2026-05-31',
      });
      const callArg = prisma.expenseDocument.aggregate.mock.calls[0][0];
      expect(callArg.where.branchId).toBe('b1');
      expect(callArg.where.deletedAt).toBeNull();
      expect(callArg.where.status).toBe('POSTED');
      expect(callArg.where.taxDisallowed).toBe(true);
      expect(callArg.where.documentDate.gte).toEqual(new Date('2026-05-01'));
      // upper bound clamps to 23:59:59.999 of the chosen day
      const lte = callArg.where.documentDate.lte as Date;
      expect(lte.getHours()).toBe(23);
      expect(lte.getMinutes()).toBe(59);
    });

    it('line-level query excludes lines whose parent doc is already flagged (avoid double-count)', async () => {
      await service.getTaxDisallowedSummary({ from: '2026-01-01', to: '2026-12-31' });
      const lineCallArg = prisma.expenseLine.aggregate.mock.calls[0][0];
      expect(lineCallArg.where.taxDisallowed).toBe(true);
      // Parent doc must NOT be doc-level disallowed (those are already counted)
      expect(lineCallArg.where.expenseDetail.document.taxDisallowed).toBe(false);
      expect(lineCallArg.where.expenseDetail.document.status).toBe('POSTED');
      expect(lineCallArg.where.expenseDetail.document.deletedAt).toBeNull();
    });
  });
});
