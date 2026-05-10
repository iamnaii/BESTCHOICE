import { Decimal } from '@prisma/client/runtime/library';
import { ExpenseAccrualTemplate } from '../../journal/cpa-templates/expense-accrual.template';

describe('ExpenseAccrualTemplate', () => {
  let template: ExpenseAccrualTemplate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;

  beforeEach(() => {
    journal = { createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-A1', id: 'je-a1' }) };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      expenseDocument: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      journalEntry: {
        findUnique: jest.fn().mockResolvedValue({ entryNumber: 'JE-A1' }),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'shop-co-1' }),
      },
    };
    template = new ExpenseAccrualTemplate(journal, prisma);
  });

  it('posts accrual JE: Dr expense + Dr VAT / Cr 21-1104 (no cash leg)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-2',
      number: 'EX-20260510-0010',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('5000.00'),
      vatAmount: new Decimal('350.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      totalAmount: new Decimal('5350.00'),
      depositAccountCode: null,
      paymentMethod: null,
      journalEntryId: null,
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1404' }] },
    });

    const result = await template.execute('doc-2');
    expect(result.entryNo).toBe('JE-A1');
    const [args] = journal.createAndPost.mock.calls[0];
    expect(args.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: '53-1404', dr: new Decimal('5000.00') }),
        expect.objectContaining({ accountCode: '11-2104', dr: new Decimal('350.00') }),
        expect.objectContaining({ accountCode: '21-1104', cr: new Decimal('5350.00') }),
      ]),
    );
    // No cash account leg
    const cashCodes = ['11-1101', '11-1102', '11-1103', '11-1201', '11-1202', '11-1203'];
    args.lines.forEach((l: { accountCode: string }) => {
      expect(cashCodes).not.toContain(l.accountCode);
    });
  });

  it('updates status=ACCRUAL (not POSTED) + clears paidAt + sets journalEntryId', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-3',
      number: 'EX-20260510-0011',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('1000.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      totalAmount: new Decimal('1000.00'),
      depositAccountCode: null,
      paymentMethod: null,
      journalEntryId: null,
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302' }] },
    });

    await template.execute('doc-3');
    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-3' },
        data: expect.objectContaining({
          status: 'ACCRUAL',
          paidAt: null,
          journalEntryId: 'je-a1',
        }),
      }),
    );
  });

  it('idempotent: skips post when journalEntryId already set', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-4',
      journalEntryId: 'je-existing-a-uuid',
    });
    prisma.journalEntry.findUnique.mockResolvedValueOnce({ entryNumber: 'JE-EXISTING-A' });
    const result = await template.execute('doc-4');
    expect(result.entryNo).toBe('JE-EXISTING-A');
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });
});
