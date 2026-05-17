import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { TaxService } from '../tax.service';
import { PrismaService } from '../../../prisma/prisma.service';

const Dec = (n: string | number) => new Prisma.Decimal(n);

describe('TaxService.previewPP30 — B3 / K-04 input VAT from 11-4101', () => {
  let service: TaxService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  // Helper: PP30 now makes 3 journalLine.findMany calls (21-2101, 21-2103, 11-4101).
  // Mocks route by accountCode in the where clause so individual tests can mock just
  // the call they care about.
  function mockJournalByCode(byCode: Record<string, unknown[]>) {
    prisma.journalLine.findMany.mockImplementation((args: { where: { accountCode: string } }) => {
      return Promise.resolve(byCode[args.where.accountCode] ?? []);
    });
  }

  beforeEach(async () => {
    prisma = {
      branch: { findMany: jest.fn() },
      payment: { findMany: jest.fn() },
      journalLine: { findMany: jest.fn() },
      expenseDocument: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(TaxService);

    // Default mocks — empty universe; individual tests override
    prisma.branch.findMany.mockResolvedValue([{ id: 'br-1' }]);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.journalLine.findMany.mockResolvedValue([]);
    prisma.expenseDocument.findMany.mockResolvedValue([]);
  });

  it('K-04: sums Dr 11-4101 journal lines as totalVatInput', async () => {
    mockJournalByCode({
      '11-4101': [
        {
          debit: Dec('70'),
          journalEntry: {
            id: 'je-1',
            postedAt: new Date('2026-05-15'),
            description: 'EX-001 vendor A',
            metadata: { flow: 'expense-same-day', documentId: 'doc-A' },
          },
        },
        {
          debit: Dec('140'),
          journalEntry: {
            id: 'je-2',
            postedAt: new Date('2026-05-18'),
            description: 'EX-002 vendor B',
            metadata: { flow: 'expense-accrual', documentId: 'doc-B' },
          },
        },
      ],
    });
    prisma.expenseDocument.findMany.mockResolvedValue([
      { id: 'doc-A', vendorName: 'Vendor A', vendorTaxId: '0123456789012', taxInvoiceNo: 'INV-A1', totalAmount: Dec('1070') },
      { id: 'doc-B', vendorName: 'Vendor B', vendorTaxId: '0123456789013', taxInvoiceNo: 'INV-B1', totalAmount: Dec('2140') },
    ]);

    const result = await service.previewPP30('co-1', 2026, 5);

    expect(result.totalVatInput.toString()).toBe('210');
    expect(result.totalPurchases.toString()).toBe('3210'); // 1070 + 2140
    expect(result.lineItems.purchases).toHaveLength(2);
    expect(result.lineItems.purchases[0].vendorName).toBe('Vendor A');
    expect(result.lineItems.purchases[0].vatAmount.toString()).toBe('70');
  });

  it('K-04: query filters by 11-4101 + debit > 0 + period + metadata.flow = expense-*', async () => {
    await service.previewPP30('co-1', 2026, 5);

    // The 11-4101 input-VAT query is one of the 3 journalLine calls — find it.
    const inputVatCall = prisma.journalLine.findMany.mock.calls.find(
      ([args]: [{ where: { accountCode: string } }]) => args.where.accountCode === '11-4101',
    );
    expect(inputVatCall).toBeDefined();
    expect(inputVatCall[0]).toMatchObject({
      where: {
        accountCode: '11-4101',
        debit: { gt: 0 },
        deletedAt: null,
        journalEntry: expect.objectContaining({
          postedAt: { gte: expect.any(Date), lte: expect.any(Date) },
          metadata: { path: ['flow'], string_starts_with: 'expense-' },
        }),
      },
    });
  });

  it('K-04: lines whose expense_document is in a different branch are excluded', async () => {
    mockJournalByCode({
      '11-4101': [
        {
          debit: Dec('70'),
          journalEntry: {
            id: 'je-1',
            postedAt: new Date('2026-05-15'),
            description: 'EX-001',
            metadata: { flow: 'expense-same-day', documentId: 'doc-from-other-co' },
          },
        },
      ],
    });
    // expenseDocument.findMany returns [] because doc's branchId not in our branchIds
    prisma.expenseDocument.findMany.mockResolvedValue([]);

    const result = await service.previewPP30('co-1', 2026, 5);

    expect(result.totalVatInput.toString()).toBe('0');
    expect(result.lineItems.purchases).toHaveLength(0);
    // The expenseDocument query MUST scope to branchIds — confirm the where clause
    expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branchId: { in: ['br-1'] },
          deletedAt: null,
        }),
      }),
    );
  });

  it('K-04: empty branches → skip 11-4101 input-VAT query (no-company-no-input-VAT)', async () => {
    prisma.branch.findMany.mockResolvedValue([]);

    const result = await service.previewPP30('co-empty', 2026, 5);

    // After Critical #2 fix: output VAT is journal-based and uses companyId
    // scoping, so 21-2101/21-2103 queries CAN run even with no branches.
    // The 11-4101 input-VAT helper is the one that bails early on empty branches.
    const inputCall = prisma.journalLine.findMany.mock.calls.find(
      ([args]: [{ where: { accountCode: string } }]) => args.where.accountCode === '11-4101',
    );
    expect(inputCall).toBeUndefined();
    expect(result.totalVatInput.toString()).toBe('0');
    expect(result.lineItems.purchases).toHaveLength(0);
  });

  it('K-04 anti-regression: lines on 11-2104 (overseas ม.83/6) are NOT picked up', async () => {
    // Even if a phantom JE with 11-2104 lines exists, our query filters
    // accountCode='11-4101' so 11-2104 must be excluded. Confirms Fix Report
    // P0-1 routing remains correct end-to-end.
    await service.previewPP30('co-1', 2026, 5);

    // Find the input-VAT call (one of 3 journalLine calls).
    const inputCall = prisma.journalLine.findMany.mock.calls.find(
      ([args]: [{ where: { accountCode: string } }]) => args.where.accountCode === '11-4101',
    );
    expect(inputCall).toBeDefined();
    expect(inputCall[0].where.accountCode).toBe('11-4101');
    expect(inputCall[0].where.accountCode).not.toBe('11-2104');
  });

  it('K-04: credit-note reversal lines (Cr 11-4101) are excluded via debit > 0 filter', async () => {
    await service.previewPP30('co-1', 2026, 5);

    const inputCall = prisma.journalLine.findMany.mock.calls.find(
      ([args]: [{ where: { accountCode: string } }]) => args.where.accountCode === '11-4101',
    );
    expect(inputCall).toBeDefined();
    expect(inputCall[0].where.debit).toEqual({ gt: 0 });
  });
});

// ────────────────────────────────────────────────────────────
// Critical #2 — VAT output is journal-based (Cr 21-2101 + 21-2103)
// ────────────────────────────────────────────────────────────

describe('TaxService.previewPP30 — Critical #2: output VAT journal-based', () => {
  let service: TaxService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  function mockJournalByCode(byCode: Record<string, unknown[]>) {
    prisma.journalLine.findMany.mockImplementation((args: { where: { accountCode: string } }) => {
      return Promise.resolve(byCode[args.where.accountCode] ?? []);
    });
  }

  beforeEach(async () => {
    prisma = {
      branch: { findMany: jest.fn() },
      payment: { findMany: jest.fn() },
      journalLine: { findMany: jest.fn() },
      expenseDocument: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [TaxService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TaxService);
    prisma.branch.findMany.mockResolvedValue([{ id: 'br-1' }]);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.journalLine.findMany.mockResolvedValue([]);
    prisma.expenseDocument.findMany.mockResolvedValue([]);
  });

  it('sums Cr 21-2101 + Cr 21-2103 as totalVatOutput (settled + 60-day mandatory)', async () => {
    mockJournalByCode({
      '21-2101': [
        // PAYMENT — Cr 21-2101 from PaymentReceipt2BTemplate
        {
          credit: Dec('70'),
          journalEntry: {
            id: 'je-pay-1',
            entryNumber: 'JE-202605-0001',
            entryDate: new Date('2026-05-10'),
            postedAt: new Date('2026-05-10'),
            referenceType: 'PAYMENT',
            referenceId: 'pay-1',
            description: 'PaymentReceipt',
          },
        },
        // OTHER_INCOME — Cr 21-2101 from OtherIncomeTemplate (asset disposal VAT)
        {
          credit: Dec('14'),
          journalEntry: {
            id: 'je-oi-1',
            entryNumber: 'JE-202605-0002',
            entryDate: new Date('2026-05-15'),
            postedAt: new Date('2026-05-15'),
            referenceType: 'OTHER_INCOME',
            referenceId: 'oi-1',
            description: 'Disposal asset',
          },
        },
        // REPOSSESSION — Cr 21-2101 from RepossessionJP5Template
        {
          credit: Dec('35'),
          journalEntry: {
            id: 'je-rep-1',
            entryNumber: 'JE-202605-0003',
            entryDate: new Date('2026-05-20'),
            postedAt: new Date('2026-05-20'),
            referenceType: 'REPOSSESSION',
            referenceId: 'rep-1',
            description: 'Repossession',
          },
        },
      ],
      '21-2103': [
        // 60-day mandatory VAT (Vat60dayMandatoryTemplate)
        {
          credit: Dec('21'),
          journalEntry: {
            id: 'je-60d-1',
            entryNumber: 'JE-202605-0099',
            entryDate: new Date('2026-05-25'),
            postedAt: new Date('2026-05-25'),
            referenceType: 'VAT_60DAY',
            description: '60-day mandatory VAT',
          },
        },
      ],
    });

    const result = await service.previewPP30('co-1', 2026, 5);

    // 70 + 14 + 35 = 119 settled, 21 mandatory → total 140
    expect(result.totalVatSettled.toString()).toBe('119');
    expect(result.totalVatMandatory60Day.toString()).toBe('21');
    expect(result.totalVatOutput.toString()).toBe('140');

    // Source breakdown by referenceType
    expect(result.vatOutputBySource.PAYMENT.toString()).toBe('70');
    expect(result.vatOutputBySource.OTHER_INCOME.toString()).toBe('14');
    expect(result.vatOutputBySource.REPOSSESSION.toString()).toBe('35');

    // 60-day mandatory items appear in dedicated line-item section
    expect(result.lineItems.mandatoryVat60Day).toHaveLength(1);
    expect(result.lineItems.mandatoryVat60Day[0].vatAmount.toString()).toBe('21');
    expect(result.lineItems.mandatoryVat60Day[0].entryNumber).toBe('JE-202605-0099');
  });

  it('queries 21-2101 with Cr > 0, POSTED, companyId, period range', async () => {
    await service.previewPP30('co-1', 2026, 5);

    const settledCall = prisma.journalLine.findMany.mock.calls.find(
      ([args]: [{ where: { accountCode: string } }]) => args.where.accountCode === '21-2101',
    );
    expect(settledCall).toBeDefined();
    expect(settledCall[0]).toMatchObject({
      where: {
        accountCode: '21-2101',
        credit: { gt: 0 },
        deletedAt: null,
        journalEntry: expect.objectContaining({
          status: 'POSTED',
          companyId: 'co-1',
          postedAt: { gte: expect.any(Date), lte: expect.any(Date) },
        }),
      },
    });
  });

  it('queries 21-2103 (60-day mandatory VAT) separately from 21-2101', async () => {
    await service.previewPP30('co-1', 2026, 5);

    const mandatoryCall = prisma.journalLine.findMany.mock.calls.find(
      ([args]: [{ where: { accountCode: string } }]) => args.where.accountCode === '21-2103',
    );
    expect(mandatoryCall).toBeDefined();
    expect(mandatoryCall[0]).toMatchObject({
      where: {
        accountCode: '21-2103',
        credit: { gt: 0 },
        deletedAt: null,
        journalEntry: expect.objectContaining({
          status: 'POSTED',
          companyId: 'co-1',
        }),
      },
    });
  });

  it('Critical #2 regression: VAT from JP5 / OtherIncome / Vat60dayMandatory is captured even when no Payment.vatAmount exists', async () => {
    // SCENARIO: month with only repossession + 60-day VAT events. The old
    // Payment-only implementation would have reported totalVatOutput=0; the
    // journal-based path catches both.
    prisma.payment.findMany.mockResolvedValue([]); // no PAID payments with vatAmount
    mockJournalByCode({
      '21-2101': [
        {
          credit: Dec('500'),
          journalEntry: {
            id: 'je-rep',
            entryNumber: 'JE-1',
            entryDate: new Date('2026-05-10'),
            postedAt: new Date('2026-05-10'),
            referenceType: 'REPOSSESSION',
            description: 'JP5',
          },
        },
      ],
      '21-2103': [
        {
          credit: Dec('100'),
          journalEntry: {
            id: 'je-60d',
            entryNumber: 'JE-2',
            entryDate: new Date('2026-05-15'),
            postedAt: new Date('2026-05-15'),
            referenceType: 'VAT_60DAY',
            description: '60-day VAT',
          },
        },
      ],
    });

    const result = await service.previewPP30('co-1', 2026, 5);

    expect(result.totalVatOutput.toString()).toBe('600'); // 500 + 100
    expect(result.totalSales.toString()).toBe('0'); // no payments
  });

  it('empty period → zero output VAT', async () => {
    const result = await service.previewPP30('co-1', 2026, 5);
    expect(result.totalVatOutput.toString()).toBe('0');
    expect(result.totalVatSettled.toString()).toBe('0');
    expect(result.totalVatMandatory60Day.toString()).toBe('0');
    expect(result.lineItems.mandatoryVat60Day).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
// SP3 — PND1 / PND3 / PND53 real previews + XLSX export
// ────────────────────────────────────────────────────────────

describe('TaxService.previewPND1 — payroll WHT from 21-3101', () => {
  let service: TaxService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      branch: { findMany: jest.fn() },
      journalLine: { findMany: jest.fn() },
      expenseDocument: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [TaxService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TaxService);
    prisma.branch.findMany.mockResolvedValue([{ id: 'br-1' }]);
    prisma.journalLine.findMany.mockResolvedValue([]);
    prisma.expenseDocument.findMany.mockResolvedValue([]);
  });

  it('returns empty result when no PAYROLL journal lines exist', async () => {
    const result = await service.previewPND1('co-1', 2026, 5);
    expect(result.items).toEqual([]);
    expect(result.whtTotal.toString()).toBe('0');
    expect(result.count).toBe(0);
    expect(result.form).toBe('PND1');
  });

  it('aggregates PayrollLine items from PAYROLL ExpenseDocument', async () => {
    prisma.journalLine.findMany.mockResolvedValue([
      {
        credit: Dec('1500'),
        journalEntry: {
          id: 'je-pr-1',
          postedAt: new Date('2026-05-31'),
          description: 'Payroll May',
          metadata: { flow: 'expense-payroll', documentId: 'pr-doc-1' },
        },
      },
    ]);
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'pr-doc-1',
        number: 'PR-20260531-0001',
        documentDate: new Date('2026-05-31'),
        paidAt: new Date('2026-05-31'),
        payroll: {
          lines: [
            {
              employeeName: 'นาย ก',
              employeeTaxId: '1234567890123',
              baseSalary: Dec('30000'),
              whtAmount: Dec('1000'),
            },
            {
              employeeName: 'นางสาว ข',
              employeeTaxId: '1234567890124',
              baseSalary: Dec('15000'),
              whtAmount: Dec('500'),
            },
          ],
        },
      },
    ]);

    const result = await service.previewPND1('co-1', 2026, 5);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].employeeName).toBe('นาย ก');
    expect(result.items[0].gross.toString()).toBe('30000');
    expect(result.items[0].whtAmount.toString()).toBe('1000');
    expect(result.whtTotal.toString()).toBe('1500');
    expect(result.grossIncome.toString()).toBe('45000');
    expect(result.count).toBe(2);
    expect(result.items[0].payrollDocNumber).toBe('PR-20260531-0001');
  });

  it('scopes by branch — branches in other companies excluded', async () => {
    prisma.branch.findMany.mockResolvedValue([]);
    const result = await service.previewPND1('co-empty', 2026, 5);
    expect(prisma.journalLine.findMany).not.toHaveBeenCalled();
    expect(result.count).toBe(0);
    expect(result.whtTotal.toString()).toBe('0');
  });

  it('Critical #1 regression: query filters by metadata.flow string_starts_with "expense-payroll" (matches payroll.template.ts)', async () => {
    await service.previewPND1('co-1', 2026, 5);
    expect(prisma.journalLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountCode: '21-3101',
          credit: { gt: 0 },
          journalEntry: expect.objectContaining({
            metadata: { path: ['flow'], string_starts_with: 'expense-payroll' },
          }),
        }),
      }),
    );
    const call = prisma.journalLine.findMany.mock.calls[0][0];
    // Anti-regression: legacy 'payroll' prefix would miss the real 'expense-payroll' flow tag
    expect(call.where.journalEntry.metadata.string_starts_with).not.toBe('payroll');
  });
});

describe('TaxService.previewPND3 / previewPND53 — vendor WHT', () => {
  let service: TaxService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      branch: { findMany: jest.fn() },
      journalLine: { findMany: jest.fn() },
      expenseDocument: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [TaxService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TaxService);
    prisma.branch.findMany.mockResolvedValue([{ id: 'br-1' }]);
    prisma.journalLine.findMany.mockResolvedValue([]);
    prisma.expenseDocument.findMany.mockResolvedValue([]);
  });

  it('PND3: empty period → zero totals', async () => {
    const r = await service.previewPND3('co-1', 2026, 5);
    expect(r.items).toEqual([]);
    expect(r.whtTotal.toString()).toBe('0');
    expect(r.form).toBe('PND3');
  });

  it('PND3: filters JournalLine by accountCode=21-3102, credit > 0, POSTED, expense-* flow', async () => {
    await service.previewPND3('co-1', 2026, 5);
    expect(prisma.journalLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountCode: '21-3102',
          credit: { gt: 0 },
          deletedAt: null,
          journalEntry: expect.objectContaining({
            status: 'POSTED',
            postedAt: { gte: expect.any(Date), lte: expect.any(Date) },
            metadata: { path: ['flow'], string_starts_with: 'expense-' },
          }),
        }),
      }),
    );
  });

  it('PND3: aggregates vendor WHT from ExpenseDocument', async () => {
    prisma.journalLine.findMany.mockResolvedValue([
      {
        credit: Dec('30'),
        journalEntry: {
          id: 'je-ex-1',
          postedAt: new Date('2026-05-15'),
          description: 'EX-001',
          metadata: { flow: 'expense-same-day', documentId: 'ex-doc-1' },
        },
      },
    ]);
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'ex-doc-1',
        number: 'EX-20260515-0001',
        vendorName: 'นายช่าง',
        vendorTaxId: '1100123456789',
        subtotal: Dec('1000'),
        documentDate: new Date('2026-05-15'),
        paidAt: new Date('2026-05-15'),
        whtFormType: 'PND3',
        expenseDetail: {
          lines: [
            {
              category: 'ค่าจ้างทำของ',
              whtPercent: Dec('3'),
              whtFormType: null,
              amountBeforeVat: Dec('1000'),
              whtAmount: Dec('30'),
            },
          ],
        },
      },
    ]);
    const r = await service.previewPND3('co-1', 2026, 5);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].vendorName).toBe('นายช่าง');
    expect(r.items[0].vendorTaxId).toBe('1100123456789');
    expect(r.items[0].incomeType).toBe('ค่าจ้างทำของ');
    expect(r.items[0].gross.toString()).toBe('1000');
    expect(r.items[0].whtPercent.toString()).toBe('3');
    expect(r.items[0].whtAmount.toString()).toBe('30');
    expect(r.whtTotal.toString()).toBe('30');
  });

  it('PND53: filters by accountCode=21-3103', async () => {
    await service.previewPND53('co-1', 2026, 5);
    const call = prisma.journalLine.findMany.mock.calls[0][0];
    expect(call.where.accountCode).toBe('21-3103');
  });

  it('PND53: aggregates juristic vendor WHT', async () => {
    prisma.journalLine.findMany.mockResolvedValue([
      {
        credit: Dec('100'),
        journalEntry: {
          id: 'je-ex-2',
          postedAt: new Date('2026-05-20'),
          description: 'EX-002',
          metadata: { flow: 'expense-accrual', documentId: 'ex-doc-2' },
        },
      },
    ]);
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'ex-doc-2',
        number: 'EX-20260520-0002',
        vendorName: 'บริษัท XYZ จำกัด',
        vendorTaxId: '0105556789012',
        subtotal: Dec('10000'),
        documentDate: new Date('2026-05-20'),
        paidAt: null,
        whtFormType: 'PND53',
        expenseDetail: {
          lines: [
            {
              category: 'ค่าบริการ',
              whtPercent: Dec('1'),
              whtFormType: null,
              amountBeforeVat: Dec('10000'),
              whtAmount: Dec('100'),
            },
          ],
        },
      },
    ]);
    const r = await service.previewPND53('co-1', 2026, 5);
    expect(r.items[0].vendorName).toBe('บริษัท XYZ จำกัด');
    expect(r.items[0].whtAmount.toString()).toBe('100');
    expect(r.whtTotal.toString()).toBe('100');
    expect(r.form).toBe('PND53');
  });

  it('Critical #3: mixed-form doc reports only relevant lines per report (no double-count)', async () => {
    // Doc with 1 PND3 line (1000) + 1 PND53 line (5000). Doc subtotal = 6000.
    // Old impl returned gross=6000 for BOTH reports → double-count.
    // New impl aggregates only matching lines.

    // First: mock for PND3 report
    prisma.journalLine.findMany.mockResolvedValue([
      {
        credit: Dec('30'), // PND3 portion 3% of 1000 = 30
        journalEntry: {
          id: 'je-mixed-1',
          postedAt: new Date('2026-05-15'),
          description: 'EX-mixed',
          metadata: { flow: 'expense-same-day', documentId: 'doc-mixed' },
        },
      },
    ]);
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'doc-mixed',
        number: 'EX-mixed',
        vendorName: 'Mixed Vendor',
        vendorTaxId: '1234567890123',
        subtotal: Dec('6000'),
        documentDate: new Date('2026-05-15'),
        paidAt: new Date('2026-05-15'),
        whtFormType: null,
        expenseDetail: {
          lines: [
            {
              category: '52-1101',
              whtPercent: Dec('3'),
              whtFormType: 'PND3',
              amountBeforeVat: Dec('1000'),
              whtAmount: Dec('30'),
            },
            {
              category: '52-1201',
              whtPercent: Dec('1'),
              whtFormType: 'PND53',
              amountBeforeVat: Dec('5000'),
              whtAmount: Dec('50'),
            },
          ],
        },
      },
    ]);
    const pnd3 = await service.previewPND3('co-1', 2026, 5);
    // Critical #3: gross is 1000 (PND3 line only), NOT 6000 (whole doc)
    expect(pnd3.items[0].gross.toString()).toBe('1000');
    expect(pnd3.items[0].whtAmount.toString()).toBe('30');

    // Now: same doc, run PND53 report
    prisma.journalLine.findMany.mockResolvedValue([
      {
        credit: Dec('50'),
        journalEntry: {
          id: 'je-mixed-2',
          postedAt: new Date('2026-05-15'),
          description: 'EX-mixed',
          metadata: { flow: 'expense-same-day', documentId: 'doc-mixed' },
        },
      },
    ]);
    const pnd53 = await service.previewPND53('co-1', 2026, 5);
    expect(pnd53.items[0].gross.toString()).toBe('5000');
    expect(pnd53.items[0].whtAmount.toString()).toBe('50');
  });

  it('Critical #3: line-level whtFormType falls back to doc-level when null', async () => {
    prisma.journalLine.findMany.mockResolvedValue([
      {
        credit: Dec('30'),
        journalEntry: {
          id: 'je-fb',
          postedAt: new Date('2026-05-15'),
          description: 'EX-fb',
          metadata: { flow: 'expense-same-day', documentId: 'doc-fb' },
        },
      },
    ]);
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'doc-fb',
        number: 'EX-fb',
        vendorName: 'Vendor FB',
        vendorTaxId: '1234567890124',
        subtotal: Dec('1000'),
        documentDate: new Date('2026-05-15'),
        paidAt: new Date('2026-05-15'),
        whtFormType: 'PND3', // doc-level
        expenseDetail: {
          lines: [
            {
              category: '52-1101',
              whtPercent: Dec('3'),
              whtFormType: null, // ← falls back to doc.whtFormType = 'PND3'
              amountBeforeVat: Dec('1000'),
              whtAmount: Dec('30'),
            },
          ],
        },
      },
    ]);
    const pnd3 = await service.previewPND3('co-1', 2026, 5);
    expect(pnd3.items).toHaveLength(1);
    expect(pnd3.items[0].gross.toString()).toBe('1000');
  });

  it('Critical #4: incomeType resolves CoA code to Thai income label', async () => {
    prisma.journalLine.findMany.mockResolvedValue([
      {
        credit: Dec('30'),
        journalEntry: {
          id: 'je-it',
          postedAt: new Date('2026-05-15'),
          description: 'EX-it',
          metadata: { flow: 'expense-same-day', documentId: 'doc-it' },
        },
      },
    ]);
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'doc-it',
        number: 'EX-it',
        vendorName: 'Vendor IT',
        vendorTaxId: '1234567890125',
        subtotal: Dec('1000'),
        documentDate: new Date('2026-05-15'),
        paidAt: new Date('2026-05-15'),
        whtFormType: 'PND3',
        expenseDetail: {
          lines: [
            {
              category: '52-1101', // → 'ค่าจ้างทำของ'
              whtPercent: Dec('3'),
              whtFormType: 'PND3',
              amountBeforeVat: Dec('1000'),
              whtAmount: Dec('30'),
            },
          ],
        },
      },
    ]);
    const r = await service.previewPND3('co-1', 2026, 5);
    // Critical #4: NOT raw '52-1101'
    expect(r.items[0].incomeType).toBe('ค่าจ้างทำของ');
    expect(r.items[0].incomeType).not.toBe('52-1101');
  });

  it('Critical #4: unrecognized 5x-xxxx CoA code falls back to "อื่นๆ — <code>"', async () => {
    prisma.journalLine.findMany.mockResolvedValue([
      {
        credit: Dec('30'),
        journalEntry: {
          id: 'je-unk',
          postedAt: new Date('2026-05-15'),
          description: 'EX-unk',
          metadata: { flow: 'expense-same-day', documentId: 'doc-unk' },
        },
      },
    ]);
    prisma.expenseDocument.findMany.mockResolvedValue([
      {
        id: 'doc-unk',
        number: 'EX-unk',
        vendorName: 'Vendor Unk',
        vendorTaxId: '1234567890126',
        subtotal: Dec('1000'),
        documentDate: new Date('2026-05-15'),
        paidAt: new Date('2026-05-15'),
        whtFormType: 'PND3',
        expenseDetail: {
          lines: [
            {
              category: '52-9999', // unmapped
              whtPercent: Dec('3'),
              whtFormType: 'PND3',
              amountBeforeVat: Dec('1000'),
              whtAmount: Dec('30'),
            },
          ],
        },
      },
    ]);
    const r = await service.previewPND3('co-1', 2026, 5);
    expect(r.items[0].incomeType).toBe('อื่นๆ — 52-9999');
  });

  it('PND3: lines whose document is in a different company are excluded', async () => {
    prisma.journalLine.findMany.mockResolvedValue([
      {
        credit: Dec('30'),
        journalEntry: {
          id: 'je-1',
          postedAt: new Date('2026-05-15'),
          description: 'EX-X',
          metadata: { flow: 'expense-same-day', documentId: 'doc-other-co' },
        },
      },
    ]);
    // ExpenseDocument scoped by branchId IN our branches — returns []
    prisma.expenseDocument.findMany.mockResolvedValue([]);
    const r = await service.previewPND3('co-1', 2026, 5);
    expect(r.items).toHaveLength(0);
    expect(r.whtTotal.toString()).toBe('0');
  });
});

describe('TaxService.exportTaxFormXlsx', () => {
  let service: TaxService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      branch: { findMany: jest.fn() },
      payment: { findMany: jest.fn() },
      journalLine: { findMany: jest.fn() },
      expenseDocument: { findMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [TaxService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TaxService);
    prisma.branch.findMany.mockResolvedValue([{ id: 'br-1' }]);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.journalLine.findMany.mockResolvedValue([]);
    prisma.expenseDocument.findMany.mockResolvedValue([]);
  });

  it('PP30 export produces a non-empty XLSX buffer', async () => {
    const buffer = await service.exportTaxFormXlsx('PP30', 'co-1', 2026, 5);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000); // xlsx zip baseline
    // XLSX is a ZIP — first bytes are 'PK'
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it('PND1 export produces a valid XLSX buffer', async () => {
    const buffer = await service.exportTaxFormXlsx('PND1', 'co-1', 2026, 5);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });
});
