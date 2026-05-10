import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PayrollTemplate } from '../../journal/cpa-templates/payroll.template';

describe('PayrollTemplate', () => {
  let template: PayrollTemplate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;

  const docId = 'pr-1';

  beforeEach(() => {
    journal = {
      createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-PR-001', id: 'je-pr-1' }),
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      expenseDocument: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      journalEntry: {
        findUnique: jest.fn().mockResolvedValue({ entryNumber: 'JE-PR-001' }),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'shop-co-1' }),
      },
    };
    template = new PayrollTemplate(journal, prisma);
  });

  it('posts balanced JE: Dr 53-1101 = sum(baseSalary) / Cr 21-3102 = sum(wht) + Cr 21-3104 = sum(sso) + Cr cash = sum(netPaid)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-20260510-0001',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('25000.00'),
      depositAccountCode: '11-1101',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2569-05',
        lines: [
          { id: '1', baseSalary: new Decimal('10000.00'), ssoEmployee: new Decimal('750.00'), whtAmount: new Decimal('0.00'), netPaid: new Decimal('9250.00') },
          { id: '2', baseSalary: new Decimal('15000.00'), ssoEmployee: new Decimal('750.00'), whtAmount: new Decimal('300.00'), netPaid: new Decimal('13950.00') },
        ],
      },
    });

    const result = await template.execute(docId);

    expect(result.entryNo).toBe('JE-PR-001');
    expect(journal.createAndPost).toHaveBeenCalledTimes(1);
    const [args] = journal.createAndPost.mock.calls[0];

    const drExpense = args.lines.find((l: { accountCode: string }) => l.accountCode === '53-1101');
    expect(drExpense.dr).toEqual(new Decimal('25000'));

    const crWht = args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3102');
    expect(crWht.cr).toEqual(new Decimal('300'));

    const crSso = args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3104');
    expect(crSso.cr).toEqual(new Decimal('1500'));

    const crCash = args.lines.find((l: { accountCode: string }) => l.accountCode === '11-1101');
    expect(crCash.cr).toEqual(new Decimal('23200'));

    // Sanity: balanced
    const sumDr = args.lines.reduce(
      (s: Decimal, l: { dr: Decimal }) => s.plus(l.dr),
      new Decimal(0),
    );
    const sumCr = args.lines.reduce(
      (s: Decimal, l: { cr: Decimal }) => s.plus(l.cr),
      new Decimal(0),
    );
    expect(sumDr.toString()).toBe('25000');
    expect(sumCr.toString()).toBe('25000');
  });

  it('idempotent: returns existing entryNo when journalEntryId set', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      journalEntryId: 'je-existing-uuid',
      payroll: { payrollPeriod: '2569-05', lines: [] },
    });
    prisma.journalEntry.findUnique.mockResolvedValueOnce({ entryNumber: 'JE-EXISTING' });

    const result = await template.execute(docId);
    expect(result.entryNo).toBe('JE-EXISTING');
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('updates document status=POSTED + paidAt + journalEntryId after post', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-20260510-0002',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('5000.00'),
      depositAccountCode: '11-1101',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2569-05',
        lines: [
          { id: '1', baseSalary: new Decimal('5000.00'), ssoEmployee: new Decimal('0.00'), whtAmount: new Decimal('0.00'), netPaid: new Decimal('5000.00') },
        ],
      },
    });

    await template.execute(docId);

    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: docId },
        data: expect.objectContaining({
          status: 'POSTED',
          paidAt: expect.any(Date),
          journalEntryId: 'je-pr-1',
        }),
      }),
    );
  });

  it('skips Cr lines when their sum is 0 (single employee with sso=0, wht=0)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-20260510-0003',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('5000.00'),
      depositAccountCode: '11-1101',
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2569-05',
        lines: [
          { id: '1', baseSalary: new Decimal('5000.00'), ssoEmployee: new Decimal('0.00'), whtAmount: new Decimal('0.00'), netPaid: new Decimal('5000.00') },
        ],
      },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];
    const codes = args.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes).not.toContain('21-3102');
    expect(codes).not.toContain('21-3104');
    expect(codes).toContain('53-1101');
    expect(codes).toContain('11-1101');
  });

  it('requires depositAccountCode (throws BadRequestException when missing)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'PR-20260510-0004',
      documentType: 'PAYROLL',
      documentDate: new Date('2026-05-10'),
      totalAmount: new Decimal('5000.00'),
      depositAccountCode: null,
      journalEntryId: null,
      payroll: {
        payrollPeriod: '2569-05',
        lines: [
          { id: '1', baseSalary: new Decimal('5000.00'), ssoEmployee: new Decimal('0.00'), whtAmount: new Decimal('0.00'), netPaid: new Decimal('5000.00') },
        ],
      },
    });

    await expect(template.execute(docId)).rejects.toThrow(BadRequestException);
  });
});
