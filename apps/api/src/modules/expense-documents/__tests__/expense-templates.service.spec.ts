import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExpenseTemplatesService } from '../expense-templates.service';

describe('ExpenseTemplatesService', () => {
  let service: ExpenseTemplatesService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let docsService: any;

  beforeEach(() => {
    prisma = {
      expenseTemplate: {
        create: jest.fn().mockResolvedValue({ id: 'tpl-1', name: 'ค่าไฟ' }),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
      },
    };
    // Documents service mock — for instantiate
    docsService = {
      create: jest.fn().mockResolvedValue({ id: 'doc-1', number: 'EX-20260510-0001' }),
      createCreditNote: jest.fn().mockResolvedValue({ id: 'doc-2' }),
      createPayroll: jest.fn().mockResolvedValue({ id: 'doc-3' }),
      createSettlement: jest.fn().mockResolvedValue({ id: 'doc-4' }),
    };
    service = new ExpenseTemplatesService(prisma, docsService);
  });

  describe('create', () => {
    it('rejects when isRecurring=true without recurringDay', async () => {
      await expect(service.create({
        name: 'X', documentType: 'EXPENSE', branchId: 'b1',
        prefilledData: {}, isRecurring: true,
      } as never, { id: 'u1', branchId: 'b1', role: 'OWNER' })).rejects.toThrow(BadRequestException);
    });

    it('rejects cross-branch for non-OWNER role', async () => {
      await expect(service.create({
        name: 'X', documentType: 'EXPENSE', branchId: 'b2',
        prefilledData: {},
      } as never, { id: 'u1', branchId: 'b1', role: 'BRANCH_MANAGER' })).rejects.toThrow(ForbiddenException);
    });

    it('happy path creates template', async () => {
      await service.create({
        name: 'ค่าไฟ', documentType: 'EXPENSE', branchId: 'b1',
        prefilledData: { vendorName: 'การไฟฟ้า', category: '53-1302' },
      } as never, { id: 'u1', branchId: 'b1', role: 'OWNER' });
      expect(prisma.expenseTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'ค่าไฟ',
            documentType: 'EXPENSE',
            createdById: 'u1',
          }),
        }),
      );
    });
  });

  describe('list', () => {
    it('filters by branchId + excludes deleted', async () => {
      await service.list({ branchId: 'b1' }, { id: 'u1', branchId: 'b1', role: 'OWNER' });
      expect(prisma.expenseTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'b1', deletedAt: null }),
        }),
      );
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt', async () => {
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({ id: 'tpl-1', branchId: 'b1', deletedAt: null });
      await service.softDelete('tpl-1', { id: 'u1', branchId: 'b1', role: 'OWNER' });
      expect(prisma.expenseTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });

    it('rejects when already deleted', async () => {
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({ id: 'tpl-1', branchId: 'b1', deletedAt: new Date() });
      await expect(service.softDelete('tpl-1', { id: 'u1', branchId: 'b1', role: 'OWNER' }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('instantiate', () => {
    it('creates EXPENSE doc with prefilledData + fromTemplateId', async () => {
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({
        id: 'tpl-1',
        documentType: 'EXPENSE',
        branchId: 'b1',
        deletedAt: null,
        prefilledData: { vendorName: 'การไฟฟ้า', category: '53-1302', paymentMethod: 'BANK_TRANSFER', depositAccountCode: '11-1201' },
      });
      await service.instantiate('tpl-1', { id: 'u1', branchId: 'b1', role: 'OWNER' });
      expect(docsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          documentType: 'EXPENSE',
          branchId: 'b1',
          vendorName: 'การไฟฟ้า',
          paymentMethod: 'BANK_TRANSFER',
          depositAccountCode: '11-1201',
          fromTemplateId: 'tpl-1',
          lines: expect.arrayContaining([
            expect.objectContaining({ category: '53-1302' }),
          ]),
        }),
        'u1',
      );
    });

    it('rejects cross-branch instantiate', async () => {
      prisma.expenseTemplate.findUniqueOrThrow.mockResolvedValue({
        id: 'tpl-1', documentType: 'EXPENSE', branchId: 'b2', deletedAt: null, prefilledData: {},
      });
      await expect(service.instantiate('tpl-1', { id: 'u1', branchId: 'b1', role: 'BRANCH_MANAGER' }))
        .rejects.toThrow(ForbiddenException);
    });
  });
});
