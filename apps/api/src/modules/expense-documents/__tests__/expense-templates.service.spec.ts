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
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
      },
      systemConfig: {
        findFirst: jest.fn().mockResolvedValue(null), // default → cap=20
      },
      // D1.2.4.2 — `$transaction(cb)` runs the callback with the prisma
      // mock itself acting as the tx client.
      $transaction: jest.fn().mockImplementation((cb) => cb(prisma)),
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

    // D1.2.4.2 — quota check + create wrapped in $transaction
    it('runs quota check + insert inside a single $transaction (TOCTOU-safe)', async () => {
      await service.create({
        name: 'ค่าไฟ', documentType: 'EXPENSE', branchId: 'b1',
        prefilledData: {},
      } as never, { id: 'u1', branchId: 'b1', role: 'OWNER' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // count + create both invoked once inside the tx callback.
      expect(prisma.expenseTemplate.count).toHaveBeenCalledWith({
        where: { createdById: 'u1', deletedAt: null },
      });
      expect(prisma.expenseTemplate.create).toHaveBeenCalled();
    });

    it('rejects when count >= cap (default cap 20, count 20 → reject)', async () => {
      prisma.expenseTemplate.count.mockResolvedValueOnce(20);
      await expect(service.create({
        name: 'ค่าไฟ', documentType: 'EXPENSE', branchId: 'b1',
        prefilledData: {},
      } as never, { id: 'u1', branchId: 'b1', role: 'OWNER' })).rejects.toThrow(/โควต้า/);
      expect(prisma.expenseTemplate.create).not.toHaveBeenCalled();
    });

    it('respects custom cap from SystemConfig (cap 5, count 5 → reject)', async () => {
      prisma.systemConfig.findFirst.mockResolvedValueOnce({ value: '5' });
      prisma.expenseTemplate.count.mockResolvedValueOnce(5);
      await expect(service.create({
        name: 'ค่าไฟ', documentType: 'EXPENSE', branchId: 'b1',
        prefilledData: {},
      } as never, { id: 'u1', branchId: 'b1', role: 'OWNER' })).rejects.toThrow(/โควต้า/);
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

    // ── Branch-scope hardening (Group 1 review follow-up) ──────────────
    it('OWNER (cross-branch) sees all branches when no filter passed', async () => {
      await service.list({}, { id: 'u1', branchId: 'b1', role: 'OWNER' });
      // No branchId on the where clause = "all branches" (cross-branch view)
      const callArg = prisma.expenseTemplate.findMany.mock.calls[0][0];
      expect(callArg.where.deletedAt).toBeNull();
      expect(callArg.where.branchId).toBeUndefined();
    });

    it('SALES (single-branch) is locked to user.branchId — ignores cross-branch filter', async () => {
      // SALES tries to spoof another branch via ?branchId=b2 — must be forced back to b1
      await service.list({ branchId: 'b2' }, { id: 'u1', branchId: 'b1', role: 'SALES' });
      expect(prisma.expenseTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'b1', deletedAt: null }),
        }),
      );
    });

    it('SALES with no user.branchId is rejected (misconfigured user)', async () => {
      await expect(
        service.list({ branchId: 'b2' }, { id: 'u1', branchId: null, role: 'SALES' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('BRANCH_MANAGER without filter is locked to their own branch', async () => {
      await service.list({}, { id: 'u1', branchId: 'b1', role: 'BRANCH_MANAGER' });
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
