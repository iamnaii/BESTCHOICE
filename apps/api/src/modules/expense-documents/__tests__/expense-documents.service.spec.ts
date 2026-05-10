import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpenseDocumentsService } from '../expense-documents.service';

describe('ExpenseDocumentsService', () => {
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

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      expenseDocument: {
        create: jest.fn().mockResolvedValue({ id: 'doc-1', number: 'EX-20260510-0001' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        aggregate: jest.fn(),
      },
      expenseDetail: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    docNumber = { next: jest.fn().mockResolvedValue('EX-20260510-0001') };
    transition = {
      assertCanPost: jest.fn(),
      assertCanVoid: jest.fn(),
      assertCanEdit: jest.fn(),
      resolveTargetStatus: jest.fn().mockReturnValue('POSTED'),
    };
    sameDay = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1' }) };
    accrual = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-2' }) };
    creditNote = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-3' }) };
    payroll = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-4' }) };
    settlement = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-5' }) };
    service = new ExpenseDocumentsService(
      prisma,
      docNumber,
      transition,
      sameDay,
      accrual,
      creditNote,
      payroll,
      settlement,
    );
  });

  describe('create', () => {
    it('generates number, creates header + ExpenseDetail in same tx', async () => {
      await service.create(
        {
          documentType: 'EXPENSE',
          branchId: 'branch-1',
          documentDate: '2026-05-10',
          subtotal: 1000,
          vatAmount: 70,
          withholdingTax: 0,
          detail: { category: '53-1302' },
        } as never,
        'user-1',
      );
      expect(docNumber.next).toHaveBeenCalledWith(prisma, 'EXPENSE', expect.any(Date));
      expect(prisma.expenseDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            number: 'EX-20260510-0001',
            documentType: 'EXPENSE',
            createdById: 'user-1',
            status: 'DRAFT',
            expenseDetail: { create: { category: '53-1302' } },
          }),
        }),
      );
    });

    it('computes totalAmount = subtotal + vatAmount when not provided', async () => {
      await service.create(
        {
          documentType: 'EXPENSE',
          branchId: 'branch-1',
          documentDate: '2026-05-10',
          subtotal: 1000,
          vatAmount: 70,
          detail: { category: '53-1302' },
        } as never,
        'user-1',
      );
      const callArg = prisma.expenseDocument.create.mock.calls[0][0];
      expect(callArg.data.totalAmount.toString()).toBe('1070');
    });
  });

  describe('list', () => {
    it('translates tab=draft to status=DRAFT', async () => {
      await service.list({ tab: 'draft' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'DRAFT' }),
        }),
      );
    });
    it('translates tab=unpaid to status=ACCRUAL', async () => {
      await service.list({ tab: 'unpaid' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'ACCRUAL' }) }),
      );
    });
    it('translates tab=recorded to status IN [ACCRUAL, POSTED]', async () => {
      await service.list({ tab: 'recorded' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['ACCRUAL', 'POSTED'] } }),
        }),
      );
    });
    it('translates tab=paid to paidAt NOT NULL', async () => {
      await service.list({ tab: 'paid' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ paidAt: { not: null } }),
        }),
      );
    });
    it('default excludes VOIDED', async () => {
      await service.list({} as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: 'VOIDED' },
            deletedAt: null,
          }),
        }),
      );
    });
  });

  describe('post', () => {
    it('calls SameDay template when paymentMethod set', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        paymentMethod: 'CASH',
        depositAccountCode: '11-1101',
      });
      transition.resolveTargetStatus.mockReturnValue('POSTED');
      await service.post('doc-1', 'user-1');
      expect(sameDay.execute).toHaveBeenCalledWith('doc-1', expect.anything());
      expect(accrual.execute).not.toHaveBeenCalled();
    });
    it('calls Accrual template when paymentMethod missing', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-2',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        paymentMethod: null,
        depositAccountCode: null,
      });
      transition.resolveTargetStatus.mockReturnValue('ACCRUAL');
      await service.post('doc-2', 'user-1');
      expect(accrual.execute).toHaveBeenCalledWith('doc-2', expect.anything());
      expect(sameDay.execute).not.toHaveBeenCalled();
    });
    it('rejects post when transition guard throws', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-3', status: 'POSTED', documentType: 'EXPENSE', paymentMethod: 'CASH',
      });
      transition.assertCanPost.mockImplementation(() => { throw new BadRequestException('not draft'); });
      await expect(service.post('doc-3', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('rejects update on POSTED doc', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({ id: 'doc-1', status: 'POSTED' });
      transition.assertCanEdit.mockImplementation(() => { throw new BadRequestException('locked'); });
      await expect(service.update('doc-1', { description: 'X' } as never, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('softDelete', () => {
    it('rejects soft-delete on non-DRAFT', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({ id: 'doc-1', status: 'ACCRUAL', deletedAt: null });
      await expect(service.softDelete('doc-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
    it('sets deletedAt for DRAFT', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({ id: 'doc-1', status: 'DRAFT', deletedAt: null });
      await service.softDelete('doc-1', 'user-1');
      expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFound for missing or soft-deleted', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockRejectedValue(new Error('not found'));
      await expect(service.findOne('missing-id')).rejects.toThrow();
    });
    it('throws NotFoundException when doc is soft-deleted (deletedAt set)', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'DRAFT', deletedAt: new Date(),
      });
      await expect(service.findOne('doc-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDailySummary', () => {
    beforeEach(() => {
      prisma.expenseDocument.findMany.mockResolvedValue([]);
    });

    it('throws when branchId missing', async () => {
      await expect(
        service.getDailySummary(
          { date: '2026-05-10' } as never,
          { id: 'u1', branchId: null, role: 'OWNER' },
        ),
      ).rejects.toThrow();
    });

    it('filters by branchId + date range + excludes VOIDED + deleted', async () => {
      await service.getDailySummary(
        { date: '2026-05-10', branchId: 'b1' } as never,
        { id: 'u1', branchId: 'b1', role: 'OWNER' },
      );
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            branchId: 'b1',
            status: { not: 'VOIDED' },
            deletedAt: null,
          }),
        }),
      );
    });

    it('aggregates byType correctly across multiple docs', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Decimal } = require('@prisma/client/runtime/library');
      prisma.expenseDocument.findMany.mockResolvedValue([
        {
          documentType: 'EXPENSE',
          totalAmount: new Decimal('1000'),
          netPayment: null,
          paymentMethod: null,
          paidAt: null,
          depositAccountCode: null,
          expenseDetail: { category: '53-1302' },
          branch: { id: 'b1', name: 'A' },
        },
        {
          documentType: 'EXPENSE',
          totalAmount: new Decimal('500'),
          netPayment: null,
          paymentMethod: null,
          paidAt: null,
          depositAccountCode: null,
          expenseDetail: { category: '53-1302' },
          branch: { id: 'b1', name: 'A' },
        },
        {
          documentType: 'PAYROLL',
          totalAmount: new Decimal('30000'),
          netPayment: null,
          paymentMethod: null,
          paidAt: null,
          depositAccountCode: null,
          expenseDetail: null,
          branch: { id: 'b1', name: 'A' },
        },
      ]);
      const result = await service.getDailySummary(
        { date: '2026-05-10', branchId: 'b1' } as never,
        { id: 'u1', branchId: 'b1', role: 'OWNER' },
      );
      expect(result.byType.EXPENSE.count).toBe(2);
      expect(result.byType.EXPENSE.total).toBe('1500.00');
      expect(result.byType.PAYROLL.count).toBe(1);
      expect(result.byType.PAYROLL.total).toBe('30000.00');
      expect(result.grandTotal).toBe('31500.00');
    });

    it('aggregates cashMovement only for docs with paidAt today + depositAccountCode', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Decimal } = require('@prisma/client/runtime/library');
      const today = new Date('2026-05-10T10:00:00Z');
      const yesterday = new Date('2026-05-09T10:00:00Z');
      prisma.expenseDocument.findMany.mockResolvedValue([
        {
          documentType: 'EXPENSE',
          totalAmount: new Decimal('1000'),
          netPayment: new Decimal('1000'),
          paymentMethod: 'CASH',
          paidAt: today,
          depositAccountCode: '11-1101',
          expenseDetail: null,
          branch: { id: 'b1', name: 'A' },
        },
        {
          documentType: 'EXPENSE',
          totalAmount: new Decimal('500'),
          netPayment: null,
          paymentMethod: null,
          paidAt: null,
          depositAccountCode: null,
          expenseDetail: null,
          branch: { id: 'b1', name: 'A' },
        },
        {
          documentType: 'EXPENSE',
          totalAmount: new Decimal('300'),
          netPayment: new Decimal('300'),
          paymentMethod: 'CASH',
          paidAt: yesterday,
          depositAccountCode: '11-1101',
          expenseDetail: null,
          branch: { id: 'b1', name: 'A' },
        },
      ]);
      const result = await service.getDailySummary(
        { date: '2026-05-10', branchId: 'b1' } as never,
        { id: 'u1', branchId: 'b1', role: 'OWNER' },
      );
      // Only the first doc (paidAt=today) should be in cashMovement
      expect(result.cashMovement['11-1101']?.count).toBe(1);
      expect(result.cashMovement['11-1101']?.out).toBe('1000.00');
    });
  });

  describe('voidDocument', () => {
    it('flips status to VOIDED for non-VOIDED doc', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'POSTED', journalEntryId: null,
      });
      await service.voidDocument('doc-1', 'user-1');
      expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'VOIDED' } }),
      );
    });
    it('rejects void when transition guard throws (already VOIDED)', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1', status: 'VOIDED', journalEntryId: null,
      });
      transition.assertCanVoid.mockImplementation(() => { throw new BadRequestException('already void'); });
      await expect(service.voidDocument('doc-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });
});
