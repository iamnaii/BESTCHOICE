import { Prisma } from '@prisma/client';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { makeExpenseDocumentsService } from './support/make-expense-documents-service';

/**
 * Phase 3 characterization — pins the CREATE-FAMILY + `update` behaviour that
 * existing specs left under-covered, exercised THROUGH the facade so the
 * delegation to ExpenseDocumentCreateService is proven equivalent.
 *
 * Gaps filled (the other creates — create / createCreditNote / createPayroll /
 * createSettlement — are already exhaustively pinned elsewhere):
 *   1. createPettyCash happy-path (full doc shape + pettyCash.validate call)
 *   2. update() happy-path (DRAFT edit persists recomputed lines/totals)
 *   3. createDraftForRepair (uses the passed-in tx; opens NO new $transaction)
 */
describe('ExpenseDocumentCreateService (via facade) — characterization', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let service: ExpenseDocumentsService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      expenseDocument: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) => Promise.resolve({ id: 'doc-1', ...data })),
        findUniqueOrThrow: jest.fn(),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) => Promise.resolve({ id: 'doc-1', ...data })),
      },
      expenseDetail: { update: jest.fn().mockResolvedValue({}) },
      expenseLine: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      chartOfAccount: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ code: '53-1101', type: 'ค่าใช้จ่าย' }]),
      },
      // readBoolFlag('petty_cash_enabled', true) → null row ⇒ default true
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    service = makeExpenseDocumentsService({
      prisma,
      docNumber: { next: jest.fn().mockResolvedValue('EX-20260610-0001') },
      pettyCash: {
        getConfig: jest.fn().mockResolvedValue({
          account: '11-1103',
          limit: new Prisma.Decimal('5000'),
          replenishThreshold: null,
        }),
        validate: jest.fn(),
      },
    }).service;
  });

  // ─── 1. createPettyCash happy-path ─────────────────────────────────────
  describe('createPettyCash — happy path', () => {
    it('creates PETTY_CASH_REIMBURSEMENT DRAFT with computed totals + lines, and calls pettyCash.validate', async () => {
      const made = makeExpenseDocumentsService({
        prisma,
        docNumber: { next: jest.fn().mockResolvedValue('PC-20260610-0001') },
        pettyCash: {
          getConfig: jest.fn().mockResolvedValue({
            account: '11-1103',
            limit: new Prisma.Decimal('5000'),
            replenishThreshold: null,
          }),
          validate: jest.fn(),
        },
      });

      await made.service.createPettyCash(
        {
          branchId: 'b1',
          documentDate: '2026-06-10',
          depositAccountCode: '11-1103',
          custodianName: 'พนักงาน X',
          lines: [
            { supplierName: 'ร้าน A', category: '53-1101', amount: 100, vatPercent: 7 },
            { supplierName: 'ร้าน B', category: '53-1101', amount: 50, vatPercent: 0 },
          ],
        } as never,
        { id: 'user-1', branchId: 'b1', role: 'OWNER' },
      );

      // V20 invariant check ran
      expect(made.pettyCash.validate).toHaveBeenCalledTimes(1);

      const callArg = prisma.expenseDocument.create.mock.calls.at(-1)![0];
      expect(callArg.data.documentType).toBe('PETTY_CASH_REIMBURSEMENT');
      expect(callArg.data.status).toBe('DRAFT');
      expect(callArg.data.paymentMethod).toBe('CASH');
      // subtotal = 100 + 50 = 150 ; vat = 100×7% = 7 ; total = 157
      expect(callArg.data.subtotal.toFixed(2)).toBe('150.00');
      expect(callArg.data.vatAmount.toFixed(2)).toBe('7.00');
      expect(callArg.data.totalAmount.toFixed(2)).toBe('157.00');
      expect(callArg.data.netPayment.toFixed(2)).toBe('157.00');
      // 2 lines persisted
      const createdLines = callArg.data.expenseDetail.create.lines.create;
      expect(createdLines).toHaveLength(2);
      expect(createdLines[0].supplierName).toBe('ร้าน A');
      expect(createdLines[1].supplierName).toBe('ร้าน B');
    });
  });

  // ─── 2. update() happy-path ────────────────────────────────────────────
  describe('update — happy path (DRAFT edit persists new lines/totals)', () => {
    it('asserts editable, validates CoA, replaces lines, persists recomputed totals', async () => {
      const made = makeExpenseDocumentsService({
        prisma,
        transition: {
          assertCanPost: jest.fn(),
          assertCanVoid: jest.fn(),
          assertCanEdit: jest.fn(),
          assertCanApprove: jest.fn(),
          resolveTargetStatus: jest.fn(),
        },
      });
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1',
        status: 'DRAFT',
        deletedAt: null,
        depositAccountCode: '11-1103',
        expenseDetail: { priceType: 'EXCLUSIVE', lines: [] },
      });

      await made.service.update(
        'doc-1',
        {
          description: 'edited',
          lines: [
            { category: '53-1101', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
          ],
        } as never,
        'user-1',
      );

      // Edit gate ran
      expect(made.transition.assertCanEdit).toHaveBeenCalledWith({ from: 'DRAFT' });
      // CoA validation ran (categories resolved via chartOfAccount.findMany)
      expect(prisma.chartOfAccount.findMany).toHaveBeenCalled();
      // Lines replaced wholesale
      expect(prisma.expenseLine.deleteMany).toHaveBeenCalledWith({
        where: { expenseDetailId: 'doc-1' },
      });
      expect(prisma.expenseDetail.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { documentId: 'doc-1' } }),
      );
      // Doc updated with recomputed totals
      const updArg = prisma.expenseDocument.update.mock.calls.at(-1)![0];
      expect(updArg.where).toEqual({ id: 'doc-1' });
      expect(updArg.data.description).toBe('edited');
      // subtotal = 1000 ; vat = 70 ; total = 1070
      expect(updArg.data.subtotal.toFixed(2)).toBe('1000.00');
      expect(updArg.data.vatAmount.toFixed(2)).toBe('70.00');
      expect(updArg.data.totalAmount.toFixed(2)).toBe('1070.00');
    });
  });

  // ─── 3. createDraftForRepair — uses passed-in tx, opens NO new $transaction ─
  describe('createDraftForRepair — external transaction', () => {
    it('creates REPAIR_SERVICE DRAFT via the passed-in tx and does NOT open this.prisma.$transaction', async () => {
      const txMock = {
        $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        expenseDocument: {
          create: jest.fn().mockResolvedValue({ id: 'rep-1' }),
        },
      };

      const result = await service.createDraftForRepair(
        {
          vendorName: 'ศูนย์ซ่อม A',
          amount: new Prisma.Decimal('500'),
          accountCode: 'S51-1105',
          description: 'ซ่อมจอ',
          branchId: 'b1',
          createdById: 'user-1',
          metadata: { repairTicketId: 'ticket-9' },
        },
        txMock as never,
      );

      // Used the passed-in tx, NOT this.prisma
      expect(txMock.expenseDocument.create).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.expenseDocument.create).not.toHaveBeenCalled();

      const callArg = txMock.expenseDocument.create.mock.calls[0][0];
      expect(callArg.data.documentType).toBe('REPAIR_SERVICE');
      expect(callArg.data.status).toBe('DRAFT');
      expect(callArg.data.vendorName).toBe('ศูนย์ซ่อม A');
      expect(callArg.select).toEqual({ id: true });
      expect(result).toEqual({ id: 'rep-1' });
    });
  });
});
