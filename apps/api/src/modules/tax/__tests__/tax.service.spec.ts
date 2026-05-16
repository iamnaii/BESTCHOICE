import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { TaxService } from '../tax.service';
import { PrismaService } from '../../../prisma/prisma.service';

const Dec = (n: string | number) => new Prisma.Decimal(n);

describe('TaxService.previewPP30 — B3 / K-04 input VAT from 11-4101', () => {
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
    prisma.journalLine.findMany.mockResolvedValue([
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
    ]);
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

    expect(prisma.journalLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountCode: '11-4101',
          debit: { gt: 0 },
          deletedAt: null,
          journalEntry: expect.objectContaining({
            postedAt: { gte: expect.any(Date), lte: expect.any(Date) },
            metadata: { path: ['flow'], string_starts_with: 'expense-' },
          }),
        }),
      }),
    );
  });

  it('K-04: lines whose expense_document is in a different branch are excluded', async () => {
    prisma.journalLine.findMany.mockResolvedValue([
      {
        debit: Dec('70'),
        journalEntry: {
          id: 'je-1',
          postedAt: new Date('2026-05-15'),
          description: 'EX-001',
          metadata: { flow: 'expense-same-day', documentId: 'doc-from-other-co' },
        },
      },
    ]);
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

  it('K-04: empty branches → skip journal query entirely (no-company-no-input-VAT)', async () => {
    prisma.branch.findMany.mockResolvedValue([]);

    const result = await service.previewPP30('co-empty', 2026, 5);

    expect(prisma.journalLine.findMany).not.toHaveBeenCalled();
    expect(result.totalVatInput.toString()).toBe('0');
    expect(result.lineItems.purchases).toHaveLength(0);
  });

  it('K-04 anti-regression: lines on 11-2104 (overseas ม.83/6) are NOT picked up', async () => {
    // Even if a phantom JE with 11-2104 lines exists, our query filters
    // accountCode='11-4101' so 11-2104 must be excluded. Confirms Fix Report
    // P0-1 routing remains correct end-to-end.
    await service.previewPP30('co-1', 2026, 5);

    const call = prisma.journalLine.findMany.mock.calls[0][0];
    expect(call.where.accountCode).toBe('11-4101');
    expect(call.where.accountCode).not.toBe('11-2104');
  });

  it('K-04: credit-note reversal lines (Cr 11-4101) are excluded via debit > 0 filter', async () => {
    // CN's reverse VAT books Cr 11-4101 (credit). Our `debit: { gt: 0 }` filter
    // skips those. This keeps the period's totalVatInput net-zero-friendly when
    // both sides exist in the same period — the CN's negative VAT contribution
    // is reflected by the absent line, not a negative one.
    await service.previewPP30('co-1', 2026, 5);

    const call = prisma.journalLine.findMany.mock.calls[0][0];
    expect(call.where.debit).toEqual({ gt: 0 });
  });
});
