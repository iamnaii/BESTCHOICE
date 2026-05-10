import { Decimal } from '@prisma/client/runtime/library';
import { ExpenseSameDayTemplate } from '../../journal/cpa-templates/expense-same-day.template';

describe('ExpenseSameDayTemplate', () => {
  let template: ExpenseSameDayTemplate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;

  const docId = 'doc-1';

  beforeEach(() => {
    journal = {
      createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-001', id: 'je-1' }),
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      expenseDocument: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      journalEntry: {
        findUnique: jest.fn().mockResolvedValue({ entryNumber: 'JE-001' }),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'shop-co-1' }),
      },
    };
    template = new ExpenseSameDayTemplate(journal, prisma);
  });

  it('posts balanced JE for EX with VAT 7% no WHT', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'EX-20260510-0001',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('1000.00'),
      vatAmount: new Decimal('70.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      totalAmount: new Decimal('1070.00'),
      depositAccountCode: '11-1101',
      paymentMethod: 'CASH',
      journalEntryId: null,
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302' }] },
    });

    const result = await template.execute(docId);

    expect(result.entryNo).toBe('JE-001');
    expect(journal.createAndPost).toHaveBeenCalledTimes(1);
    const [args] = journal.createAndPost.mock.calls[0];
    expect(args.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: '53-1302', dr: new Decimal('1000.00') }),
        expect.objectContaining({ accountCode: '11-2104', dr: new Decimal('70.00') }),
        expect.objectContaining({ accountCode: '11-1101', cr: new Decimal('1070.00') }),
      ]),
    );
    // metadata
    expect(args.metadata).toMatchObject({ tag: 'EXPENSE_SAME_DAY', documentId: docId });
    expect(args.postedAt).toEqual(new Date('2026-05-10'));
  });

  it('skips VAT line when vatAmount = 0', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'EX-20260510-0002',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('500.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      totalAmount: new Decimal('500.00'),
      depositAccountCode: '11-1101',
      paymentMethod: 'CASH',
      journalEntryId: null,
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302' }] },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];
    const codes = args.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes).not.toContain('11-2104');
  });

  it('routes WHT to 21-3102 when whtFormType=PND3 (บุคคลธรรมดา)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'EX-20260510-0003',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('1000.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('30.00'),
      whtFormType: 'PND3',
      totalAmount: new Decimal('1000.00'),
      depositAccountCode: '11-1201',
      paymentMethod: 'BANK_TRANSFER',
      journalEntryId: null,
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1702' }] },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];
    const whtLine = args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3102');
    expect(whtLine).toBeDefined();
    expect(whtLine.cr).toEqual(new Decimal('30.00'));
    // Cash leg = total - wht = 970
    const cashLine = args.lines.find((l: { accountCode: string }) => l.accountCode === '11-1201');
    expect(cashLine.cr).toEqual(new Decimal('970.00'));
  });

  it('routes WHT to 21-3103 when whtFormType=PND53 (นิติบุคคล)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'EX-20260510-0004',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('1000.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('30.00'),
      whtFormType: 'PND53',
      totalAmount: new Decimal('1000.00'),
      depositAccountCode: '11-1201',
      paymentMethod: 'BANK_TRANSFER',
      journalEntryId: null,
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1702' }] },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3103')).toBeDefined();
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3102')).toBeUndefined();
  });

  it('idempotent: returns existing entryNo when journalEntryId already set', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      journalEntryId: 'je-existing-uuid',
    });
    // Idempotency path looks up entryNumber by stored JE id (UUID).
    prisma.journalEntry.findUnique.mockResolvedValueOnce({ entryNumber: 'JE-EXISTING' });
    const result = await template.execute(docId);
    expect(result.entryNo).toBe('JE-EXISTING');
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('updates document status=POSTED + paidAt + journalEntryId after post', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'EX-20260510-0005',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('500.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      totalAmount: new Decimal('500.00'),
      depositAccountCode: '11-1101',
      paymentMethod: 'CASH',
      journalEntryId: null,
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302' }] },
    });

    await template.execute(docId);

    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: docId },
        data: expect.objectContaining({
          status: 'POSTED',
          paidAt: expect.any(Date),
          journalEntryId: 'je-1',
        }),
      }),
    );
  });
});
