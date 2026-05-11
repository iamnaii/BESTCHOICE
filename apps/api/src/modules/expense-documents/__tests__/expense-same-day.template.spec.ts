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
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302', amountBeforeVat: new Decimal('1000.00') }] },
    });

    const result = await template.execute(docId);

    expect(result.entryNo).toBe('JE-001');
    expect(journal.createAndPost).toHaveBeenCalledTimes(1);
    const [args] = journal.createAndPost.mock.calls[0];
    expect(args.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: '53-1302', dr: new Decimal('1000.00') }),
        expect.objectContaining({ accountCode: '11-4101', dr: new Decimal('70.00') }),
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
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302', amountBeforeVat: new Decimal('500.00') }] },
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
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1702', amountBeforeVat: new Decimal('1000.00') }] },
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
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1702', amountBeforeVat: new Decimal('1000.00') }] },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3103')).toBeDefined();
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3102')).toBeUndefined();
  });

  // Fix Report P2-4 — per-line WHT routing
  it('mixed PND3 + PND53: aggregates per-line whtFormType into 2 Cr rows', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-mixed-wht',
      number: 'EX-20260511-0099',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-11'),
      subtotal: new Decimal('2000.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('80.00'),
      whtFormType: 'PND3', // doc default (irrelevant since all lines set their own)
      totalAmount: new Decimal('2000.00'),
      depositAccountCode: '11-1201',
      paymentMethod: 'BANK_TRANSFER',
      journalEntryId: null,
      expenseDetail: {
        priceType: 'EXCLUSIVE',
        lines: [
          {
            lineNo: 1,
            category: '53-1702',
            amountBeforeVat: new Decimal('1000.00'),
            whtAmount: new Decimal('30.00'),
            whtFormType: 'PND3', // บุคคล → 21-3102
          },
          {
            lineNo: 2,
            category: '53-1303',
            amountBeforeVat: new Decimal('1000.00'),
            whtAmount: new Decimal('50.00'),
            whtFormType: 'PND53', // นิติบุคคล → 21-3103
          },
        ],
      },
    });

    await template.execute('doc-mixed-wht');
    const [args] = journal.createAndPost.mock.calls[0];
    const cr3102 = args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3102');
    const cr3103 = args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3103');
    expect(cr3102).toBeDefined();
    expect(cr3102.cr).toEqual(new Decimal('30'));
    expect(cr3103).toBeDefined();
    expect(cr3103.cr).toEqual(new Decimal('50'));
    // Cash leg = total − total wht (30 + 50 = 80) = 1920
    const cashLine = args.lines.find((l: { accountCode: string }) => l.accountCode === '11-1201');
    expect(cashLine.cr).toEqual(new Decimal('1920'));
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
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302', amountBeforeVat: new Decimal('500.00') }] },
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

  it('multi-line: 2 categories aggregate to 2 Dr rows', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-multi', number: 'EX-20260511-0010',
      documentType: 'EXPENSE',
      documentDate: new Date('2026-05-11'),
      subtotal: new Decimal('1500'),
      vatAmount: new Decimal('105'),
      withholdingTax: new Decimal('0'),
      totalAmount: new Decimal('1605'),
      depositAccountCode: '11-1101',
      journalEntryId: null,
      expenseDetail: {
        priceType: 'EXCLUSIVE',
        lines: [
          { lineNo: 1, category: '53-1101', amountBeforeVat: new Decimal('1000'), vatAmount: new Decimal('70'), whtAmount: new Decimal('0') },
          { lineNo: 2, category: '53-1404', amountBeforeVat: new Decimal('500'),  vatAmount: new Decimal('35'), whtAmount: new Decimal('0') },
        ],
      },
    });
    await template.execute('doc-multi');
    const args = journal.createAndPost.mock.calls[0][0];
    const dr5x = args.lines.filter((l: { accountCode: string }) => l.accountCode.startsWith('5'));
    expect(dr5x).toHaveLength(2);
    expect(dr5x.find((l: { accountCode: string; dr: { toString: () => string } }) => l.accountCode === '53-1101').dr.toString()).toBe('1000');
  });

  // Fix Report P2-2 — per-line journal_lines (no collapse by category).
  it('multi-line: 3 lines, 2 share category — 3 Dr rows (line-level preserved)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-collapse', number: 'EX-20260511-0011',
      documentType: 'EXPENSE',
      documentDate: new Date('2026-05-11'),
      subtotal: new Decimal('2300'),
      vatAmount: new Decimal('161'),
      withholdingTax: new Decimal('0'),
      totalAmount: new Decimal('2461'),
      depositAccountCode: '11-1101',
      journalEntryId: null,
      expenseDetail: {
        priceType: 'EXCLUSIVE',
        lines: [
          { lineNo: 1, category: '53-1101', description: 'รายการ A', amountBeforeVat: new Decimal('1000'), vatAmount: new Decimal('70'),  whtAmount: new Decimal('0') },
          { lineNo: 2, category: '53-1404', description: 'รายการ B', amountBeforeVat: new Decimal('800'),  vatAmount: new Decimal('56'),  whtAmount: new Decimal('0') },
          { lineNo: 3, category: '53-1101', description: 'รายการ C', amountBeforeVat: new Decimal('500'),  vatAmount: new Decimal('35'),  whtAmount: new Decimal('0') },
        ],
      },
    });
    await template.execute('doc-collapse');
    const args = journal.createAndPost.mock.calls[0][0];
    const dr5x = args.lines.filter((l: { accountCode: string }) => l.accountCode.startsWith('5'));
    expect(dr5x).toHaveLength(3); // P2-2: per-line, NOT collapsed by category
    // Sum across the 53-1101 lines (2 of them) still = 1500 — total preserved
    const sum1101 = dr5x
      .filter((l: { accountCode: string }) => l.accountCode === '53-1101')
      .reduce(
        (s: number, l: { dr: { toString: () => string } }) => s + parseFloat(l.dr.toString()),
        0,
      );
    expect(sum1101).toBe(1500);
    const drA = dr5x.find((l: { description: string }) => l.description.includes('รายการ A'));
    expect(drA.dr.toString()).toBe('1000');
    const drC = dr5x.find((l: { description: string }) => l.description.includes('รายการ C'));
    expect(drC.dr.toString()).toBe('500');
  });
});
