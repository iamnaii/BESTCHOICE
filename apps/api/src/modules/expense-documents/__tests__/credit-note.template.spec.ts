import { Decimal } from '@prisma/client/runtime/library';
import { CreditNoteTemplate } from '../../journal/cpa-templates/credit-note.template';

describe('CreditNoteTemplate', () => {
  let template: CreditNoteTemplate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;

  beforeEach(() => {
    journal = { createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-CN-001', id: 'je-cn-1' }) };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      expenseDocument: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'company-shop' }),
      },
      // CoA validation guard — returns a valid expense account list by default.
      // ChartOfAccount.type stores the Thai label from the CSV seed (NOT 'EXPENSE').
      chartOfAccount: {
        findFirst: jest.fn().mockResolvedValue({ code: '53-1404', type: 'ค่าใช้จ่าย' }),
        findMany: jest.fn().mockResolvedValue([{ code: '53-1404', type: 'ค่าใช้จ่าย' }]),
      },
    };
    template = new CreditNoteTemplate(journal, prisma);
  });

  it('reverses ACCRUAL original: Dr 21-1104 + Dr cash=0 / Cr expense + Cr 11-4101', async () => {
    // CN doc
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-1') return Promise.resolve({
        id: 'cn-1',
        number: 'CN-20260510-0001',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-10'),
        subtotal: new Decimal('500.00'),
        vatAmount: new Decimal('35.00'),
        withholdingTax: new Decimal('0.00'),
        totalAmount: new Decimal('535.00'),
        depositAccountCode: null,
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-1', reason: 'partial return', category: '53-1404' },
        expenseDetail: {
          priceType: 'EXCLUSIVE',
          lines: [{ lineNo: 1, category: '53-1404', amountBeforeVat: new Decimal('500.00') }],
        },
      });
      if (args.where.id === 'orig-1') return Promise.resolve({
        id: 'orig-1',
        status: 'ACCRUAL',
        depositAccountCode: null,
      });
      return Promise.reject(new Error('unknown id'));
    });
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([{ code: '53-1404', type: 'ค่าใช้จ่าย' }]);

    const result = await template.execute('cn-1');
    expect(result.entryNo).toBe('JE-CN-001');
    const [args] = journal.createAndPost.mock.calls[0];
    const dr = args.lines.filter((l: { dr: Decimal }) => l.dr.gt(0));
    const cr = args.lines.filter((l: { cr: Decimal }) => l.cr.gt(0));
    // ACCRUAL reverse: debit AP (21-1104) for total
    expect(dr).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: '21-1104', dr: new Decimal('535.00') }),
    ]));
    // Credit expense + VAT
    expect(cr).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: '53-1404', cr: new Decimal('500.00') }),
      expect.objectContaining({ accountCode: '11-4101', cr: new Decimal('35.00') }),
    ]));
    // No cash account in lines (ACCRUAL didn't pay yet)
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode.startsWith('11-1'))).toBeUndefined();
  });

  it('reverses POSTED original: Dr cash + Dr 11-4101 / Cr expense (refund flow)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-2') return Promise.resolve({
        id: 'cn-2',
        number: 'CN-20260510-0002',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-10'),
        subtotal: new Decimal('1000.00'),
        vatAmount: new Decimal('70.00'),
        withholdingTax: new Decimal('0.00'),
        totalAmount: new Decimal('1070.00'),
        depositAccountCode: '11-1101',
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-2', reason: 'full return', category: '53-1302' },
        expenseDetail: {
          priceType: 'EXCLUSIVE',
          lines: [{ lineNo: 1, category: '53-1302', amountBeforeVat: new Decimal('1000.00') }],
        },
      });
      if (args.where.id === 'orig-2') return Promise.resolve({
        id: 'orig-2',
        status: 'POSTED',
        depositAccountCode: '11-1101',
        withholdingTax: null,
        whtFormType: null,
      });
      return Promise.reject(new Error('unknown id'));
    });
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([{ code: '53-1302', type: 'ค่าใช้จ่าย' }]);

    await template.execute('cn-2');
    const [args] = journal.createAndPost.mock.calls[0];
    // POSTED reverse: cash debit (refund), Cr expense + VAT
    expect(args.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: '11-1101', dr: new Decimal('1070.00') }),
      expect.objectContaining({ accountCode: '53-1302', cr: new Decimal('1000.00') }),
      expect.objectContaining({ accountCode: '11-4101', cr: new Decimal('70.00') }),
    ]));
  });

  it('idempotent: skip when CN already has journalEntryId', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'cn-3',
      journalEntryId: 'je-existing',
    });
    prisma.journalEntry = {
      findUnique: jest.fn().mockResolvedValue({ id: 'je-existing', entryNumber: 'JE-EXISTING' }),
    };
    const result = await template.execute('cn-3');
    expect(result.entryNo).toBe('JE-EXISTING');
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('ACCRUAL-path CN: status=POSTED + paidAt=null (no cash moved) + journalEntryId', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-4') return Promise.resolve({
        id: 'cn-4',
        number: 'CN-20260510-0004',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-10'),
        subtotal: new Decimal('100.00'),
        vatAmount: new Decimal('0.00'),
        withholdingTax: new Decimal('0.00'),
        totalAmount: new Decimal('100.00'),
        depositAccountCode: null,
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-4', reason: 'r', category: '53-1302' },
        expenseDetail: {
          priceType: 'EXCLUSIVE',
          lines: [{ lineNo: 1, category: '53-1302', amountBeforeVat: new Decimal('100.00') }],
        },
      });
      if (args.where.id === 'orig-4') return Promise.resolve({
        id: 'orig-4',
        status: 'ACCRUAL',
        depositAccountCode: null,
      });
      return Promise.reject(new Error('unknown id'));
    });
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([{ code: '53-1302', type: 'ค่าใช้จ่าย' }]);

    await template.execute('cn-4');
    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cn-4' },
        data: expect.objectContaining({
          status: 'POSTED',
          paidAt: null,
          netPayment: null,
          journalEntryId: 'je-cn-1',
        }),
      }),
    );
  });

  it('POSTED-path CN (cash refund): paidAt + netPayment populated', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-5') return Promise.resolve({
        id: 'cn-5',
        number: 'CN-20260510-0005',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-10'),
        subtotal: new Decimal('200.00'),
        vatAmount: new Decimal('0.00'),
        withholdingTax: new Decimal('0.00'),
        totalAmount: new Decimal('200.00'),
        depositAccountCode: '11-1101',
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-5', reason: 'r', category: '53-1302' },
        expenseDetail: {
          priceType: 'EXCLUSIVE',
          lines: [{ lineNo: 1, category: '53-1302', amountBeforeVat: new Decimal('200.00') }],
        },
      });
      if (args.where.id === 'orig-5') return Promise.resolve({
        id: 'orig-5',
        status: 'POSTED',
        depositAccountCode: '11-1101',
        withholdingTax: null,
        whtFormType: null,
      });
      return Promise.reject(new Error('unknown id'));
    });
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([{ code: '53-1302', type: 'ค่าใช้จ่าย' }]);

    await template.execute('cn-5');
    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cn-5' },
        data: expect.objectContaining({
          status: 'POSTED',
          paidAt: expect.any(Date),
          netPayment: expect.any(Object),
          journalEntryId: 'je-cn-1',
        }),
      }),
    );
  });

  it('rejects post when category code is missing from CoA', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'cn-coa-missing',
      number: 'CN-20260510-7777',
      documentType: 'CREDIT_NOTE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('100.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('0.00'),
      totalAmount: new Decimal('100.00'),
      depositAccountCode: null,
      journalEntryId: null,
      creditNote: { originalDocumentId: 'orig', reason: 'r', category: '99-9999' },
      expenseDetail: {
        priceType: 'EXCLUSIVE',
        lines: [{ lineNo: 1, category: '99-9999', amountBeforeVat: new Decimal('100.00') }],
      },
    });
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([]); // code not found
    await expect(template.execute('cn-coa-missing')).rejects.toThrow(
      /ไม่พบในผังบัญชี/,
    );
  });

  it('rejects post when category prefix is not 5x-xxxx (asset/liability code)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'cn-non-expense-prefix',
      number: 'CN-20260510-7778',
      documentType: 'CREDIT_NOTE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('100.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('0.00'),
      totalAmount: new Decimal('100.00'),
      depositAccountCode: null,
      journalEntryId: null,
      // 11-2101 is asset prefix → prefix guard rejects regardless of type
      creditNote: { originalDocumentId: 'orig', reason: 'r', category: '11-2101' },
      expenseDetail: {
        priceType: 'EXCLUSIVE',
        lines: [{ lineNo: 1, category: '11-2101', amountBeforeVat: new Decimal('100.00') }],
      },
    });
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([{ code: '11-2101', type: 'สินทรัพย์' }]);
    await expect(template.execute('cn-non-expense-prefix')).rejects.toThrow(
      /ไม่ใช่บัญชีค่าใช้จ่าย/,
    );
  });

  it('rejects post when 5x-xxxx code has type !== "ค่าใช้จ่าย" (defense-in-depth — type guard)', async () => {
    // Synthetic case: a 5x-xxxx code that the prefix guard accepts but the
    // type guard rejects. No such row exists in the current seed, but if a
    // future seed mis-classifies a 5x-xxxx as "ต้นทุน" or similar this guard
    // is what stops the JE from posting to the wrong bucket.
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'cn-typo-coa',
      number: 'CN-20260510-7779',
      documentType: 'CREDIT_NOTE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('100.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('0.00'),
      totalAmount: new Decimal('100.00'),
      depositAccountCode: null,
      journalEntryId: null,
      creditNote: { originalDocumentId: 'orig', reason: 'r', category: '53-9999' },
      expenseDetail: {
        priceType: 'EXCLUSIVE',
        lines: [{ lineNo: 1, category: '53-9999', amountBeforeVat: new Decimal('100.00') }],
      },
    });
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([{ code: '53-9999', type: 'ต้นทุน' }]);
    await expect(template.execute('cn-typo-coa')).rejects.toThrow(
      /ไม่ใช่บัญชีค่าใช้จ่าย/,
    );
  });

  it('rejects post when original is VOIDED', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-x') return Promise.resolve({
        id: 'cn-x',
        number: 'CN-20260510-9999',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-10'),
        subtotal: new Decimal('100.00'),
        vatAmount: new Decimal('0.00'),
        withholdingTax: new Decimal('0.00'),
        totalAmount: new Decimal('100.00'),
        depositAccountCode: null,
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-x', reason: 'r', category: '53-1302' },
        expenseDetail: {
          priceType: 'EXCLUSIVE',
          lines: [{ lineNo: 1, category: '53-1302', amountBeforeVat: new Decimal('100.00') }],
        },
      });
      if (args.where.id === 'orig-x') return Promise.resolve({
        id: 'orig-x',
        status: 'VOIDED',
        depositAccountCode: null,
      });
      return Promise.reject(new Error('unknown id'));
    });
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([{ code: '53-1302', type: 'ค่าใช้จ่าย' }]);
    await expect(template.execute('cn-x')).rejects.toThrow(/สถานะ VOIDED/);
  });

  it('VAT line skipped when CN has no VAT', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-5') return Promise.resolve({
        id: 'cn-5',
        number: 'CN-20260510-0005',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-10'),
        subtotal: new Decimal('200.00'),
        vatAmount: new Decimal('0.00'),
        withholdingTax: new Decimal('0.00'),
        totalAmount: new Decimal('200.00'),
        depositAccountCode: null,
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-5', reason: 'r', category: '53-1302' },
        expenseDetail: {
          priceType: 'EXCLUSIVE',
          lines: [{ lineNo: 1, category: '53-1302', amountBeforeVat: new Decimal('200.00') }],
        },
      });
      if (args.where.id === 'orig-5') return Promise.resolve({
        id: 'orig-5',
        status: 'ACCRUAL',
        depositAccountCode: null,
      });
      return Promise.reject(new Error('unknown id'));
    });
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([{ code: '53-1302', type: 'ค่าใช้จ่าย' }]);

    await template.execute('cn-5');
    const [args] = journal.createAndPost.mock.calls[0];
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '11-2104')).toBeUndefined();
  });

  it('multi-line CN: 2 line categories → 2 Cr expense rows', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-multi') return Promise.resolve({
        id: 'cn-multi',
        number: 'CN-20260511-0050',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-11'),
        subtotal: new Decimal('1500'),
        vatAmount: new Decimal('0'),
        withholdingTax: new Decimal('0'),
        totalAmount: new Decimal('1500'),
        depositAccountCode: null,
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-multi', reason: 'partial return' },
        expenseDetail: {
          priceType: 'EXCLUSIVE',
          lines: [
            { lineNo: 1, category: '53-1101', amountBeforeVat: new Decimal('1000'), vatAmount: new Decimal('0'), whtAmount: new Decimal('0') },
            { lineNo: 2, category: '53-1404', amountBeforeVat: new Decimal('500'),  vatAmount: new Decimal('0'), whtAmount: new Decimal('0') },
          ],
        },
      });
      if (args.where.id === 'orig-multi') return Promise.resolve({
        id: 'orig-multi', status: 'ACCRUAL', depositAccountCode: null,
      });
      return Promise.reject(new Error('unknown id'));
    });
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([
      { code: '53-1101', type: 'ค่าใช้จ่าย' },
      { code: '53-1404', type: 'ค่าใช้จ่าย' },
    ]);
    await template.execute('cn-multi');
    const args = journal.createAndPost.mock.calls[0][0];
    const cr5x = args.lines.filter((l: { accountCode: string; cr: Decimal }) => l.accountCode.startsWith('5') && l.cr.gt(0));
    expect(cr5x).toHaveLength(2);
  });

  it('POSTED-path CN: WHT reversal — Dr 21-3102 for original WHT + cash Dr reduced by WHT', async () => {
    // Defense-in-depth test: even though service blocks CN on WHT'd docs in production,
    // the template should correctly reverse the WHT liability if it ever reaches this path.
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-wht') return Promise.resolve({
        id: 'cn-wht',
        number: 'CN-20260510-0099',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-10'),
        subtotal: new Decimal('1000.00'),
        vatAmount: new Decimal('0.00'),
        withholdingTax: new Decimal('0.00'),
        totalAmount: new Decimal('1000.00'),
        depositAccountCode: '11-1101',
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-wht', reason: 'full return' },
        expenseDetail: {
          priceType: 'EXCLUSIVE',
          lines: [{ lineNo: 1, category: '53-1302', amountBeforeVat: new Decimal('1000.00') }],
        },
      });
      if (args.where.id === 'orig-wht') return Promise.resolve({
        id: 'orig-wht',
        status: 'POSTED',
        depositAccountCode: '11-1101',
        withholdingTax: new Decimal('30.00'),
        whtFormType: 'PND3',
      });
      return Promise.reject(new Error('unknown id'));
    });
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([{ code: '53-1302', type: 'ค่าใช้จ่าย' }]);

    await template.execute('cn-wht');
    const [callArgs] = journal.createAndPost.mock.calls[0];
    const drLines = callArgs.lines.filter((l: { dr: Decimal }) => l.dr.gt(0));

    // Cash refund should be total − origWht = 1000 − 30 = 970
    expect(drLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: '11-1101', dr: new Decimal('970.00') }),
    ]));
    // WHT payable reversal
    expect(drLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: '21-3102', dr: new Decimal('30.00') }),
    ]));
  });
});
