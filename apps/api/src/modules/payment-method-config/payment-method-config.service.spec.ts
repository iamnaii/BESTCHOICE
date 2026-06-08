import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethodConfigService } from './payment-method-config.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * CHARACTERIZATION (golden) spec — pins CURRENT behavior of
 * PaymentMethodConfigService. Asserts what the code does today; does not judge
 * correctness. Mock-based only (no real DB).
 *
 * Pinned invariants:
 *  • create/update of a new default demotes the prior default (only one default)
 *  • removing the last enabled row for a method throws BadRequestException
 *  • create against a soft-deleted (method, accountCode) UNDELETES + overwrites
 *    the existing row instead of inserting a duplicate
 */

interface FakePrisma {
  paymentMethodConfig: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    count: jest.Mock;
  };
}

describe('PaymentMethodConfigService (characterization)', () => {
  let service: PaymentMethodConfigService;
  let prisma: FakePrisma;

  beforeEach(async () => {
    prisma = {
      paymentMethodConfig: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodConfigService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<PaymentMethodConfigService>(PaymentMethodConfigService);
  });

  // ───────────────────────────────────────────────────────────────────────
  // list / listByMethod — pin the soft-delete + ordering query shape
  // ───────────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('excludes soft-deleted and orders by method, sortOrder, accountCode', () => {
      prisma.paymentMethodConfig.findMany.mockReturnValue('LIST_RESULT');

      const result = service.list();

      expect(result).toBe('LIST_RESULT');
      expect(prisma.paymentMethodConfig.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: [
          { method: 'asc' },
          { sortOrder: 'asc' },
          { accountCode: 'asc' },
        ],
      });
    });
  });

  describe('listByMethod', () => {
    it('filters by method + enabled + not-deleted, default-first ordering', () => {
      prisma.paymentMethodConfig.findMany.mockReturnValue('BY_METHOD_RESULT');

      const result = service.listByMethod('CASH');

      expect(result).toBe('BY_METHOD_RESULT');
      expect(prisma.paymentMethodConfig.findMany).toHaveBeenCalledWith({
        where: { method: 'CASH', enabled: true, deletedAt: null },
        orderBy: [
          { isDefault: 'desc' },
          { sortOrder: 'asc' },
          { accountCode: 'asc' },
        ],
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // create — only-one-default + undelete-overwrite
  // ───────────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creating a NEW default demotes the prior default of the same method, then inserts', async () => {
      // No existing (method, accountCode) row → fresh create path.
      prisma.paymentMethodConfig.findUnique.mockResolvedValue(null);
      prisma.paymentMethodConfig.updateMany.mockResolvedValue({ count: 1 });
      prisma.paymentMethodConfig.create.mockResolvedValue({ id: 'new-1' });

      const result = await service.create({
        method: 'CASH',
        accountCode: '11-1101',
        isDefault: true,
      } as any);

      // demote prior default first
      expect(prisma.paymentMethodConfig.updateMany).toHaveBeenCalledWith({
        where: { method: 'CASH', isDefault: true, deletedAt: null },
        data: { isDefault: false },
      });
      // then a real insert (NOT update — no existing row)
      expect(prisma.paymentMethodConfig.create).toHaveBeenCalledWith({
        data: {
          method: 'CASH',
          accountCode: '11-1101',
          isDefault: true,
          enabled: true,
          sortOrder: 0,
        },
      });
      expect(prisma.paymentMethodConfig.update).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'new-1' });
    });

    it('does NOT demote when the new row is not a default; applies enabled/sortOrder defaults', async () => {
      prisma.paymentMethodConfig.findUnique.mockResolvedValue(null);
      prisma.paymentMethodConfig.create.mockResolvedValue({ id: 'new-2' });

      await service.create({
        method: 'QR',
        accountCode: '11-1201',
      } as any);

      expect(prisma.paymentMethodConfig.updateMany).not.toHaveBeenCalled();
      // isDefault?? false, enabled?? true, sortOrder?? 0
      expect(prisma.paymentMethodConfig.create).toHaveBeenCalledWith({
        data: {
          method: 'QR',
          accountCode: '11-1201',
          isDefault: false,
          enabled: true,
          sortOrder: 0,
        },
      });
    });

    it('throws ConflictException when an ACTIVE (not soft-deleted) duplicate exists', async () => {
      prisma.paymentMethodConfig.findUnique.mockResolvedValue({
        id: 'dup-1',
        method: 'CASH',
        accountCode: '11-1101',
        deletedAt: null,
      });

      await expect(
        service.create({
          method: 'CASH',
          accountCode: '11-1101',
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.paymentMethodConfig.create).not.toHaveBeenCalled();
      expect(prisma.paymentMethodConfig.update).not.toHaveBeenCalled();
    });

    it('undelete: re-creating a soft-deleted (method, accountCode) UPDATES the existing row (no duplicate insert)', async () => {
      const softDeleted = {
        id: 'old-deleted-1',
        method: 'TRANSFER',
        accountCode: '11-1201',
        deletedAt: new Date('2026-01-01T00:00:00Z'),
      };
      prisma.paymentMethodConfig.findUnique.mockResolvedValue(softDeleted);
      prisma.paymentMethodConfig.update.mockResolvedValue({
        id: 'old-deleted-1',
        deletedAt: null,
      });

      const result = await service.create({
        method: 'TRANSFER',
        accountCode: '11-1201',
        sortOrder: 5,
      } as any);

      // overwrites the SAME id, clears deletedAt — never calls create()
      expect(prisma.paymentMethodConfig.update).toHaveBeenCalledWith({
        where: { id: 'old-deleted-1' },
        data: {
          isDefault: false,
          enabled: true,
          sortOrder: 5,
          deletedAt: null,
        },
      });
      expect(prisma.paymentMethodConfig.create).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'old-deleted-1', deletedAt: null });
    });

    it('undelete of a default row still demotes the prior default before overwriting', async () => {
      const softDeleted = {
        id: 'old-deleted-2',
        method: 'CASH',
        accountCode: '11-1102',
        deletedAt: new Date('2026-01-01T00:00:00Z'),
      };
      prisma.paymentMethodConfig.findUnique.mockResolvedValue(softDeleted);
      prisma.paymentMethodConfig.updateMany.mockResolvedValue({ count: 1 });
      prisma.paymentMethodConfig.update.mockResolvedValue({ id: 'old-deleted-2' });

      await service.create({
        method: 'CASH',
        accountCode: '11-1102',
        isDefault: true,
      } as any);

      expect(prisma.paymentMethodConfig.updateMany).toHaveBeenCalledWith({
        where: { method: 'CASH', isDefault: true, deletedAt: null },
        data: { isDefault: false },
      });
      expect(prisma.paymentMethodConfig.update).toHaveBeenCalledWith({
        where: { id: 'old-deleted-2' },
        data: {
          isDefault: true,
          enabled: true,
          sortOrder: 0,
          deletedAt: null,
        },
      });
      expect(prisma.paymentMethodConfig.create).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // update — promote-to-default demotes the others (only-one-default)
  // ───────────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('promoting a non-default row to default demotes the OTHER defaults of the same method first', async () => {
      prisma.paymentMethodConfig.findFirst.mockResolvedValue({
        id: 'row-1',
        method: 'CASH',
        isDefault: false,
      });
      prisma.paymentMethodConfig.updateMany.mockResolvedValue({ count: 1 });
      prisma.paymentMethodConfig.update.mockResolvedValue({
        id: 'row-1',
        isDefault: true,
      });

      const result = await service.update('row-1', { isDefault: true } as any);

      expect(prisma.paymentMethodConfig.updateMany).toHaveBeenCalledWith({
        where: {
          method: 'CASH',
          isDefault: true,
          deletedAt: null,
          id: { not: 'row-1' },
        },
        data: { isDefault: false },
      });
      expect(prisma.paymentMethodConfig.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: { isDefault: true },
      });
      expect(result).toEqual({ id: 'row-1', isDefault: true });
    });

    it('does NOT demote when the row is already the default', async () => {
      prisma.paymentMethodConfig.findFirst.mockResolvedValue({
        id: 'row-2',
        method: 'CASH',
        isDefault: true,
      });
      prisma.paymentMethodConfig.update.mockResolvedValue({ id: 'row-2' });

      await service.update('row-2', { isDefault: true } as any);

      expect(prisma.paymentMethodConfig.updateMany).not.toHaveBeenCalled();
      expect(prisma.paymentMethodConfig.update).toHaveBeenCalledWith({
        where: { id: 'row-2' },
        data: { isDefault: true },
      });
    });

    it('does NOT demote when dto.isDefault is not true (e.g. only sortOrder changes)', async () => {
      prisma.paymentMethodConfig.findFirst.mockResolvedValue({
        id: 'row-3',
        method: 'QR',
        isDefault: false,
      });
      prisma.paymentMethodConfig.update.mockResolvedValue({ id: 'row-3' });

      await service.update('row-3', { sortOrder: 9 } as any);

      expect(prisma.paymentMethodConfig.updateMany).not.toHaveBeenCalled();
      expect(prisma.paymentMethodConfig.update).toHaveBeenCalledWith({
        where: { id: 'row-3' },
        data: { sortOrder: 9 },
      });
    });

    it('throws NotFoundException when the row does not exist (or is soft-deleted)', async () => {
      prisma.paymentMethodConfig.findFirst.mockResolvedValue(null);

      await expect(
        service.update('missing', { isDefault: true } as any),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.paymentMethodConfig.update).not.toHaveBeenCalled();
      expect(prisma.paymentMethodConfig.updateMany).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // remove — refuse to delete the last enabled row for a method
  // ───────────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('throws BadRequestException when it is the LAST enabled row for the method', async () => {
      prisma.paymentMethodConfig.findFirst.mockResolvedValue({
        id: 'last-1',
        method: 'CASH',
        enabled: true,
      });
      // no other enabled rows remain
      prisma.paymentMethodConfig.count.mockResolvedValue(0);

      await expect(service.remove('last-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(prisma.paymentMethodConfig.count).toHaveBeenCalledWith({
        where: {
          method: 'CASH',
          enabled: true,
          deletedAt: null,
          id: { not: 'last-1' },
        },
      });
      expect(prisma.paymentMethodConfig.update).not.toHaveBeenCalled();
    });

    it('soft-deletes (deletedAt set + enabled false) when other enabled rows remain', async () => {
      prisma.paymentMethodConfig.findFirst.mockResolvedValue({
        id: 'one-of-many',
        method: 'CASH',
        enabled: true,
      });
      prisma.paymentMethodConfig.count.mockResolvedValue(2);
      prisma.paymentMethodConfig.update.mockResolvedValue({
        id: 'one-of-many',
        enabled: false,
      });

      const result = await service.remove('one-of-many');

      expect(prisma.paymentMethodConfig.update).toHaveBeenCalledTimes(1);
      const updateArg = prisma.paymentMethodConfig.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: 'one-of-many' });
      expect(updateArg.data.enabled).toBe(false);
      expect(updateArg.data.deletedAt).toBeInstanceOf(Date);
      expect(result).toEqual({ id: 'one-of-many', enabled: false });
    });

    it('throws NotFoundException when the row does not exist', async () => {
      prisma.paymentMethodConfig.findFirst.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(prisma.paymentMethodConfig.count).not.toHaveBeenCalled();
      expect(prisma.paymentMethodConfig.update).not.toHaveBeenCalled();
    });
  });
});
