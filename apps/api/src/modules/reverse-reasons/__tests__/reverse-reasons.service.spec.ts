import { NotFoundException } from '@nestjs/common';
import { ReverseReasonsService } from '../reverse-reasons.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * InternalControlActionBar — unit tests for the admin-managed dropdown.
 * Verifies CRUD semantics + soft-delete + reorder atomicity.
 */
describe('ReverseReasonsService', () => {
  let prisma: {
    reverseReason: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      aggregate: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: ReverseReasonsService;

  beforeEach(() => {
    prisma = {
      reverseReason: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((promises) => Promise.all(promises)),
    };
    service = new ReverseReasonsService(prisma as unknown as PrismaService);
  });

  describe('listActive', () => {
    it('returns only active, sorted by (sortOrder, createdAt)', async () => {
      const rows = [
        { id: '1', label: 'A', sortOrder: 10, isActive: true },
        { id: '2', label: 'B', sortOrder: 20, isActive: true },
      ];
      prisma.reverseReason.findMany.mockResolvedValue(rows);
      const result = await service.listActive();
      expect(result).toEqual(rows);
      expect(prisma.reverseReason.findMany).toHaveBeenCalledWith({
        where: { isActive: true, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('create', () => {
    it('appends to end of list (max + 10) when sortOrder not provided', async () => {
      prisma.reverseReason.aggregate.mockResolvedValue({ _max: { sortOrder: 50 } });
      prisma.reverseReason.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'new', ...data, createdAt: new Date(), updatedAt: new Date() }),
      );
      await service.create({ label: 'new label' });
      expect(prisma.reverseReason.create).toHaveBeenCalledWith({
        data: { label: 'new label', sortOrder: 60, isActive: true },
      });
    });

    it('starts at 10 when table is empty', async () => {
      prisma.reverseReason.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      prisma.reverseReason.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'new', ...data }),
      );
      await service.create({ label: 'first' });
      expect(prisma.reverseReason.create).toHaveBeenCalledWith({
        data: { label: 'first', sortOrder: 10, isActive: true },
      });
    });

    it('trims whitespace from label', async () => {
      prisma.reverseReason.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
      prisma.reverseReason.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'x', ...data }),
      );
      await service.create({ label: '  padded  ', sortOrder: 5 });
      expect(prisma.reverseReason.create).toHaveBeenCalledWith({
        data: { label: 'padded', sortOrder: 5, isActive: true },
      });
    });
  });

  describe('update', () => {
    it('rejects unknown id with NotFoundException', async () => {
      prisma.reverseReason.findFirst.mockResolvedValue(null);
      await expect(service.update('ghost', { label: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('writes only provided fields', async () => {
      prisma.reverseReason.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.reverseReason.update.mockResolvedValue({ id: 'r1', label: 'updated' });
      await service.update('r1', { label: '  trimmed  ' });
      expect(prisma.reverseReason.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { label: 'trimmed', sortOrder: undefined, isActive: undefined },
      });
    });
  });

  describe('remove', () => {
    it('soft-deletes and forces inactive', async () => {
      prisma.reverseReason.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.reverseReason.update.mockResolvedValue({ id: 'r1' });
      await service.remove('r1');
      expect(prisma.reverseReason.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({ isActive: false, deletedAt: expect.any(Date) }),
      });
    });

    it('rejects unknown id with NotFoundException', async () => {
      prisma.reverseReason.findFirst.mockResolvedValue(null);
      await expect(service.remove('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reorder', () => {
    it('writes every row inside a single transaction', async () => {
      const rows = [
        { id: 'r1', sortOrder: 30 },
        { id: 'r2', sortOrder: 10 },
        { id: 'r3', sortOrder: 20 },
      ];
      prisma.reverseReason.findMany
        // first call inside reorder (existence check)
        .mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }])
        // second call from listAll() in the return
        .mockResolvedValueOnce([]);
      prisma.reverseReason.update.mockImplementation(({ where, data }) =>
        Promise.resolve({ id: where.id, ...data }),
      );

      await service.reorder({ rows });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // 3 update calls happen inside the transaction
      expect(prisma.reverseReason.update).toHaveBeenCalledTimes(3);
    });

    it('rejects when an id is missing from the DB', async () => {
      prisma.reverseReason.findMany.mockResolvedValueOnce([{ id: 'r1' }]);
      await expect(
        service.reorder({
          rows: [
            { id: 'r1', sortOrder: 10 },
            { id: 'ghost', sortOrder: 20 },
          ],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
