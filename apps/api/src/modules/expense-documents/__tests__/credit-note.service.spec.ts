import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { LineAggregatorService } from '../services/line-aggregator.service';

const VALID_LINES = [
  { category: '53-1302', quantity: 1, unitPrice: 200, vatPercent: 0, whtPercent: 0 },
];

describe('ExpenseDocumentsService.createCreditNote', () => {
  let service: ExpenseDocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let docNumber: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let transition: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sameDay: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let accrual: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let creditNote: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payroll: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let settlement: any;

  const ORIG_ID = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      expenseDocument: {
        create: jest.fn().mockResolvedValue({ id: 'cn-1', number: 'CN-20260510-0001' }),
        findUniqueOrThrow: jest.fn(),
        aggregate: jest.fn(),
      },
      chartOfAccount: {
        findMany: jest.fn().mockResolvedValue([
          { code: '53-1302', type: 'ค่าใช้จ่าย' },
        ]),
      },
    };
    docNumber = { next: jest.fn().mockResolvedValue('CN-20260510-0001') };
    transition = { assertCanPost: jest.fn(), assertCanVoid: jest.fn(), assertCanEdit: jest.fn(), resolveTargetStatus: jest.fn() };
    sameDay = { execute: jest.fn() };
    accrual = { execute: jest.fn() };
    creditNote = { execute: jest.fn() };
    payroll = { execute: jest.fn() };
    settlement = { execute: jest.fn() };
    service = new ExpenseDocumentsService(
      prisma,
      docNumber,
      transition,
      sameDay,
      accrual,
      creditNote,
      payroll,
      settlement,
      { createAndPost: jest.fn() } as never,
      new LineAggregatorService(),
      { preview: jest.fn() } as never,
      { validateContribution: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never,
      { getConfig: jest.fn(), validate: jest.fn() } as never,
      { loadWhitelist: jest.fn().mockResolvedValue(new Set()), validateLine: jest.fn() } as never,
    );
  });

  it('rejects when original not found', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockRejectedValue(new Error('not found'));
    await expect(service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'partial',
      lines: VALID_LINES,
    } as never, 'user-1')).rejects.toThrow();
  });

  it('rejects when original is different branch', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ORIG_ID,
      branchId: 'b2',
      documentType: 'EXPENSE',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302' }] },
    });
    await expect(service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'partial',
      lines: VALID_LINES,
    } as never, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects when original is not EXPENSE type', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ORIG_ID,
      branchId: 'b1',
      documentType: 'PAYROLL',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      expenseDetail: null,
    });
    await expect(service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'r',
      lines: VALID_LINES,
    } as never, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects when original is DRAFT or VOIDED', async () => {
    for (const status of ['DRAFT', 'VOIDED']) {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: ORIG_ID,
        branchId: 'b1',
        documentType: 'EXPENSE',
        status,
        totalAmount: new Decimal('1000.00'),
        expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302' }] },
      });
      await expect(service.createCreditNote({
        branchId: 'b1',
        documentDate: '2026-05-10',
        originalDocumentId: ORIG_ID,
        reason: 'r',
        lines: VALID_LINES,
      } as never, 'user-1')).rejects.toThrow(BadRequestException);
    }
  });

  it('rejects when original has WHT > 0', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ORIG_ID,
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      withholdingTax: new Decimal('30.00'),
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302' }] },
    });
    await expect(service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'r',
      lines: VALID_LINES,
    } as never, 'user-1')).rejects.toThrow(/หัก ณ ที่จ่าย/);
  });

  it('rejects when computed total > cap (prior CNs reduce remaining)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ORIG_ID,
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      withholdingTax: new Decimal('0'),
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302' }] },
    });
    // Prior CNs total 900 → cap = 100; our lines = 200 → reject
    prisma.expenseDocument.aggregate.mockResolvedValue({ _sum: { totalAmount: new Decimal('900.00') } });
    await expect(service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'r',
      lines: VALID_LINES, // unitPrice 200 > cap 100
    } as never, 'user-1')).rejects.toThrow(/เกินยอดที่ลดได้/);
  });

  it('happy path creates CN with originalDocumentId + correct creditNote relation', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ORIG_ID,
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      withholdingTax: new Decimal('0'),
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1302' }] },
    });
    prisma.expenseDocument.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });

    await service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'partial return',
      lines: [
        { category: '53-1302', quantity: 1, unitPrice: 200, vatPercent: 14, whtPercent: 0 },
      ],
    } as never, 'user-1');

    expect(prisma.expenseDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number: 'CN-20260510-0001',
          documentType: 'CREDIT_NOTE',
          createdById: 'user-1',
          status: 'DRAFT',
          creditNote: {
            create: expect.objectContaining({
              originalDocumentId: ORIG_ID,
              reason: 'partial return',
            }),
          },
        }),
      }),
    );
  });

  it('createCreditNote attaches expenseDetail.lines for CreditNoteTemplate to read', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ORIG_ID,
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      withholdingTax: new Decimal('0'),
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [{ lineNo: 1, category: '53-1404' }] },
    });
    prisma.expenseDocument.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });
    prisma.chartOfAccount.findMany.mockResolvedValue([
      { code: '53-1404', type: 'ค่าใช้จ่าย' },
    ]);

    await service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-11',
      originalDocumentId: ORIG_ID,
      reason: 'partial return',
      lines: [{ category: '53-1404', quantity: 1, unitPrice: 500, vatPercent: 0, whtPercent: 0 }],
    } as never, 'user-1');

    const callArg = prisma.expenseDocument.create.mock.calls[0][0];
    expect(callArg.data.expenseDetail.create.lines.create).toHaveLength(1);
    expect(callArg.data.expenseDetail.create.lines.create[0].category).toBe('53-1404');
  });

  it('rejects when CoA code is not expense type', async () => {
    prisma.chartOfAccount.findMany.mockResolvedValue([
      { code: '53-1302', type: 'สินทรัพย์' }, // wrong type
    ]);
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ORIG_ID,
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      withholdingTax: new Decimal('0'),
      expenseDetail: { priceType: 'EXCLUSIVE', lines: [] },
    });
    prisma.expenseDocument.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });

    await expect(service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'test',
      lines: VALID_LINES,
    } as never, 'user-1')).rejects.toThrow(/ไม่ใช่ "ค่าใช้จ่าย"/);
  });

  // ─── C4 · STANDALONE mode ──────────────────────────────────────────────────

  describe('STANDALONE mode', () => {
    it('rejects STANDALONE without vendorName', async () => {
      await expect(
        service.createCreditNote(
          {
            mode: 'STANDALONE',
            branchId: 'b1',
            documentDate: '2026-05-10',
            reason: 'supplier refund',
            lines: VALID_LINES,
          } as never,
          'user-1',
        ),
      ).rejects.toThrow(/STANDALONE ต้องระบุชื่อผู้ขาย/);
    });

    it('rejects LINKED without originalDocumentId', async () => {
      await expect(
        service.createCreditNote(
          {
            mode: 'LINKED',
            branchId: 'b1',
            documentDate: '2026-05-10',
            reason: 'partial',
            lines: VALID_LINES,
          } as never,
          'user-1',
        ),
      ).rejects.toThrow(/LINKED ต้องระบุเอกสารต้นฉบับ/);
    });

    it('STANDALONE skips original lookup + cap check entirely', async () => {
      await service.createCreditNote(
        {
          mode: 'STANDALONE',
          branchId: 'b1',
          documentDate: '2026-05-10',
          vendorName: 'ABC Supplier Co., Ltd.',
          vendorTaxId: '0123456789012',
          reason: 'supplier refund without original invoice',
          lines: VALID_LINES,
        } as never,
        'user-1',
      );

      // No original doc lookup, no aggregate, no advisory lock for STANDALONE.
      expect(prisma.expenseDocument.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prisma.expenseDocument.aggregate).not.toHaveBeenCalled();
      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();

      const callArg = prisma.expenseDocument.create.mock.calls[0][0];
      expect(callArg.data.documentType).toBe('CREDIT_NOTE');
      expect(callArg.data.vendorName).toBe('ABC Supplier Co., Ltd.');
      expect(callArg.data.vendorTaxId).toBe('0123456789012');
      expect(callArg.data.creditNote.create.mode).toBe('STANDALONE');
      expect(callArg.data.creditNote.create.originalDocumentId).toBeNull();
      expect(callArg.data.creditNote.create.reason).toBe('supplier refund without original invoice');
    });

    it('LINKED (default) still inherits vendor from original', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: ORIG_ID,
        branchId: 'b1',
        documentType: 'EXPENSE',
        status: 'POSTED',
        totalAmount: new Decimal('1000.00'),
        withholdingTax: new Decimal('0'),
        vendorName: 'Original Vendor Inc.',
        vendorTaxId: '9999999999999',
        expenseDetail: { priceType: 'EXCLUSIVE', lines: [] },
      });
      prisma.expenseDocument.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });

      await service.createCreditNote(
        {
          // mode omitted → defaults to LINKED
          branchId: 'b1',
          documentDate: '2026-05-10',
          originalDocumentId: ORIG_ID,
          reason: 'partial refund',
          lines: VALID_LINES,
        } as never,
        'user-1',
      );

      const callArg = prisma.expenseDocument.create.mock.calls[0][0];
      expect(callArg.data.creditNote.create.mode).toBe('LINKED');
      expect(callArg.data.creditNote.create.originalDocumentId).toBe(ORIG_ID);
      expect(callArg.data.vendorName).toBe('Original Vendor Inc.');
      expect(callArg.data.vendorTaxId).toBe('9999999999999');
    });
  });
});
