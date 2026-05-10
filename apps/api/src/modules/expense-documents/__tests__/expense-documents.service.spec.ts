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
    service = new ExpenseDocumentsService(prisma, docNumber, transition, sameDay, accrual, creditNote);
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
