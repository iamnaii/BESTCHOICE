import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { LineAggregatorService } from '../services/line-aggregator.service';

describe('ExpenseDocumentsService.createSettlement', () => {
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

  const EX_ID = '00000000-0000-4000-8000-000000000001';
  const owner = { id: 'user-1', branchId: 'b1', role: 'OWNER' };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      expenseDocument: {
        create: jest.fn().mockResolvedValue({
          id: 'se-1',
          number: 'SE-20260510-0001',
          settlement: { settlementLines: [] },
        }),
        findUniqueOrThrow: jest.fn(),
      },
      settlementLine: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountSettled: null } }),
      },
    };
    docNumber = { next: jest.fn().mockResolvedValue('SE-20260510-0001') };
    transition = {
      assertCanPost: jest.fn(),
      assertCanVoid: jest.fn(),
      assertCanEdit: jest.fn(),
      resolveTargetStatus: jest.fn(),
    };
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

  it('rejects when cleared doc not found', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockRejectedValue(new Error('not found'));
    await expect(
      service.createSettlement(
        {
          branchId: 'b1',
          documentDate: '2026-05-10',
          depositAccountCode: '11-1101',
          lines: [{ clearedDocumentId: EX_ID, amountSettled: 100 }],
        } as never,
        owner,
      ),
    ).rejects.toThrow();
  });

  it('rejects when cleared doc is not ACCRUAL (e.g., POSTED)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: EX_ID,
      number: 'EX-1',
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      deletedAt: null,
    });
    await expect(
      service.createSettlement(
        {
          branchId: 'b1',
          documentDate: '2026-05-10',
          depositAccountCode: '11-1101',
          lines: [{ clearedDocumentId: EX_ID, amountSettled: 100 }],
        } as never,
        owner,
      ),
    ).rejects.toThrow(/ACCRUAL/);
  });

  it('rejects when cleared doc is different branch', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: EX_ID,
      number: 'EX-1',
      branchId: 'b2',
      documentType: 'EXPENSE',
      status: 'ACCRUAL',
      totalAmount: new Decimal('1000.00'),
      deletedAt: null,
    });
    await expect(
      service.createSettlement(
        {
          branchId: 'b1',
          documentDate: '2026-05-10',
          depositAccountCode: '11-1101',
          lines: [{ clearedDocumentId: EX_ID, amountSettled: 100 }],
        } as never,
        owner,
      ),
    ).rejects.toThrow(/สาขาอื่น/);
  });

  it('rejects when amountSettled > original.totalAmount (cap exceeded)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: EX_ID,
      number: 'EX-1',
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'ACCRUAL',
      totalAmount: new Decimal('1000.00'),
      deletedAt: null,
    });
    prisma.settlementLine.aggregate.mockResolvedValue({
      _sum: { amountSettled: null },
    });

    await expect(
      service.createSettlement(
        {
          branchId: 'b1',
          documentDate: '2026-05-10',
          depositAccountCode: '11-1101',
          lines: [{ clearedDocumentId: EX_ID, amountSettled: 1500 }],
        } as never,
        owner,
      ),
    ).rejects.toThrow(/เกินยอดที่ค้าง/);
  });

  it('happy path: creates SE with lines, sums correctly', async () => {
    const EX2_ID = '00000000-0000-4000-8000-000000000002';
    prisma.expenseDocument.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: EX_ID,
        number: 'EX-1',
        branchId: 'b1',
        documentType: 'EXPENSE',
        status: 'ACCRUAL',
        totalAmount: new Decimal('1000.00'),
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: EX2_ID,
        number: 'EX-2',
        branchId: 'b1',
        documentType: 'EXPENSE',
        status: 'ACCRUAL',
        totalAmount: new Decimal('2000.00'),
        deletedAt: null,
      });

    await service.createSettlement(
      {
        branchId: 'b1',
        documentDate: '2026-05-10',
        depositAccountCode: '11-1101',
        lines: [
          { clearedDocumentId: EX_ID, amountSettled: 1000 },
          { clearedDocumentId: EX2_ID, amountSettled: 2000 },
        ],
      } as never,
      owner,
    );

    expect(prisma.expenseDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number: 'SE-20260510-0001',
          documentType: 'VENDOR_SETTLEMENT',
          createdById: 'user-1',
          status: 'DRAFT',
          subtotal: expect.any(Decimal),
          totalAmount: expect.any(Decimal),
          netPayment: expect.any(Decimal),
          settlement: {
            create: {
              settlementLines: {
                create: [
                  expect.objectContaining({ clearedDocumentId: EX_ID }),
                  expect.objectContaining({ clearedDocumentId: EX2_ID }),
                ],
              },
            },
          },
        }),
      }),
    );
    // Verify totals
    const callArg = prisma.expenseDocument.create.mock.calls[0][0];
    expect(callArg.data.subtotal.toString()).toBe('3000');
    expect(callArg.data.totalAmount.toString()).toBe('3000');
    expect(callArg.data.netPayment.toString()).toBe('3000');
  });

  it('rejects branch access for non-cross-branch user trying other branch', async () => {
    const sales = { id: 'user-2', branchId: 'b1', role: 'SALES' };
    await expect(
      service.createSettlement(
        {
          branchId: 'b2',
          documentDate: '2026-05-10',
          depositAccountCode: '11-1101',
          lines: [{ clearedDocumentId: EX_ID, amountSettled: 100 }],
        } as never,
        sales,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects duplicate clearedDocumentId in lines', async () => {
    await expect(
      service.createSettlement(
        {
          branchId: 'b1',
          documentDate: '2026-05-10',
          depositAccountCode: '11-1101',
          lines: [
            { clearedDocumentId: EX_ID, amountSettled: 500 },
            { clearedDocumentId: EX_ID, amountSettled: 600 },
          ],
        } as never,
        owner,
      ),
    ).rejects.toThrow(/ปรากฏซ้ำในรายการ/);
  });

  it('rejects WHT > sumSettled', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: EX_ID,
      number: 'EX-1',
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'ACCRUAL',
      totalAmount: new Decimal('1000.00'),
      deletedAt: null,
    });
    await expect(
      service.createSettlement(
        {
          branchId: 'b1',
          documentDate: '2026-05-10',
          depositAccountCode: '11-1101',
          withholdingTax: 200,
          lines: [{ clearedDocumentId: EX_ID, amountSettled: 100 }],
        } as never,
        owner,
      ),
    ).rejects.toThrow(/หัก ณ ที่จ่าย/);
  });

  it('cap aggregation only counts POSTED SEs (DRAFT does not consume cap)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: EX_ID,
      number: 'EX-1',
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'ACCRUAL',
      totalAmount: new Decimal('1000.00'),
      deletedAt: null,
    });
    prisma.settlementLine.aggregate.mockResolvedValue({
      _sum: { amountSettled: null },
    });

    await service.createSettlement(
      {
        branchId: 'b1',
        documentDate: '2026-05-10',
        depositAccountCode: '11-1101',
        lines: [{ clearedDocumentId: EX_ID, amountSettled: 1000 }],
      } as never,
      owner,
    );

    // Confirm aggregation filter uses status === 'POSTED' (not "not VOIDED")
    expect(prisma.settlementLine.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          settlement: expect.objectContaining({
            document: expect.objectContaining({
              status: 'POSTED',
              deletedAt: null,
            }),
          }),
        }),
      }),
    );
  });

  it('acquires advisory locks in sorted+deduped order', async () => {
    const ID_A = '00000000-0000-4000-8000-00000000000a';
    const ID_B = '00000000-0000-4000-8000-00000000000b';
    const ID_C = '00000000-0000-4000-8000-00000000000c';
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ID_A,
      number: 'EX-A',
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'ACCRUAL',
      totalAmount: new Decimal('10000.00'),
      deletedAt: null,
    });

    await service.createSettlement(
      {
        branchId: 'b1',
        documentDate: '2026-05-10',
        depositAccountCode: '11-1101',
        // intentionally unsorted (C, A, B) — expect lock order A, B, C
        lines: [
          { clearedDocumentId: ID_C, amountSettled: 100 },
          { clearedDocumentId: ID_A, amountSettled: 100 },
          { clearedDocumentId: ID_B, amountSettled: 100 },
        ],
      } as never,
      owner,
    );

    const lockCalls = (prisma.$executeRawUnsafe as jest.Mock).mock.calls;
    expect(lockCalls.length).toBe(3);
    expect(lockCalls[0][1]).toBe(ID_A);
    expect(lockCalls[1][1]).toBe(ID_B);
    expect(lockCalls[2][1]).toBe(ID_C);
  });
});
