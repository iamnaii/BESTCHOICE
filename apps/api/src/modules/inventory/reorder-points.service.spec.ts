import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReorderPointsService } from './reorder-points.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('ReorderPointsService', () => {
  let service: ReorderPointsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;

  const baseReorderPoint = {
    id: 'rp-1',
    brand: 'Apple',
    model: 'iPhone 15',
    storage: '128GB',
    category: 'PHONE_NEW',
    branchId: 'b-1',
    minQuantity: 3,
    reorderQuantity: 10,
    isActive: true,
    deletedAt: null,
    branch: { id: 'b-1', name: 'สาขาลาดพร้าว' },
  };

  beforeEach(async () => {
    prisma = {
      reorderPoint: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn((args) => Promise.resolve({ id: 'rp-new', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ ...baseReorderPoint, ...args.data })),
      },
      product: {
        count: jest.fn().mockResolvedValue(0),
      },
      branch: {
        findUnique: jest.fn().mockResolvedValue({ id: 'b-1', deletedAt: null }),
      },
      stockAlert: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    notifications = { send: jest.fn().mockResolvedValue(undefined) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ReorderPointsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = mod.get(ReorderPointsService);
  });

  describe('findAll', () => {
    it('applies filters: branchId, isActive, category', async () => {
      prisma.reorderPoint.findMany.mockResolvedValue([baseReorderPoint]);
      await service.findAll({ branchId: 'b-1', isActive: true, category: 'PHONE_NEW' });
      const where = prisma.reorderPoint.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.branchId).toBe('b-1');
      expect(where.isActive).toBe(true);
      expect(where.category).toBe('PHONE_NEW');
    });

    it('marks isLow=true when currentStock <= minQuantity', async () => {
      prisma.reorderPoint.findMany.mockResolvedValue([baseReorderPoint]);
      prisma.product.count.mockResolvedValue(2); // 2 ≤ 3
      const result = await service.findAll({});
      expect(result.data[0].isLow).toBe(true);
      expect(result.data[0].currentStock).toBe(2);
    });

    it('marks isLow=false when stock above minQuantity', async () => {
      prisma.reorderPoint.findMany.mockResolvedValue([baseReorderPoint]);
      prisma.product.count.mockResolvedValue(5); // 5 > 3
      const result = await service.findAll({});
      expect(result.data[0].isLow).toBe(false);
    });

    it('caps limit at 100', async () => {
      await service.findAll({ limit: 999 });
      const args = prisma.reorderPoint.findMany.mock.calls[0][0];
      expect(args.take).toBe(100);
    });

    it('defaults to page 1 limit 50 when missing', async () => {
      await service.findAll({});
      const args = prisma.reorderPoint.findMany.mock.calls[0][0];
      expect(args.take).toBe(50);
      expect(args.skip).toBe(0);
    });
  });

  describe('findOne', () => {
    it('returns row when found', async () => {
      prisma.reorderPoint.findUnique.mockResolvedValue(baseReorderPoint);
      const result = await service.findOne('rp-1');
      expect(result.id).toBe('rp-1');
    });

    it('throws NotFound when missing', async () => {
      prisma.reorderPoint.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const validDto = {
      brand: 'Apple',
      model: 'iPhone 15',
      storage: '128GB',
      category: 'PHONE_NEW',
      branchId: 'b-1',
      minQuantity: 3,
      reorderQuantity: 10,
    };

    it('creates a new reorder point', async () => {
      prisma.reorderPoint.findFirst.mockResolvedValue(null);
      const result = await service.create(validDto);
      expect(result.id).toBe('rp-new');
      expect(prisma.reorderPoint.create).toHaveBeenCalled();
    });

    it('rejects duplicate (same brand/model/storage/category/branch)', async () => {
      prisma.reorderPoint.findFirst.mockResolvedValue(baseReorderPoint);
      await expect(service.create(validDto)).rejects.toThrow(BadRequestException);
    });

    it('rejects when branch missing', async () => {
      prisma.reorderPoint.findFirst.mockResolvedValue(null);
      prisma.branch.findUnique.mockResolvedValue(null);
      await expect(service.create(validDto)).rejects.toThrow(NotFoundException);
    });

    it('rejects when branch soft-deleted', async () => {
      prisma.reorderPoint.findFirst.mockResolvedValue(null);
      prisma.branch.findUnique.mockResolvedValue({ id: 'b-1', deletedAt: new Date() });
      await expect(service.create(validDto)).rejects.toThrow(NotFoundException);
    });

    it('stores null storage when DTO.storage is empty string', async () => {
      prisma.reorderPoint.findFirst.mockResolvedValue(null);
      await service.create({ ...validDto, storage: '' });
      const data = prisma.reorderPoint.create.mock.calls[0][0].data;
      expect(data.storage).toBeNull();
    });
  });

  describe('update', () => {
    it('updates only supplied fields', async () => {
      prisma.reorderPoint.findUnique.mockResolvedValue(baseReorderPoint);
      await service.update('rp-1', { minQuantity: 5 });
      const data = prisma.reorderPoint.update.mock.calls[0][0].data;
      expect(data.minQuantity).toBe(5);
    });

    it('throws NotFound when id missing', async () => {
      prisma.reorderPoint.findUnique.mockResolvedValue(null);
      await expect(service.update('missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (soft-delete)', () => {
    it('sets deletedAt instead of hard-delete', async () => {
      prisma.reorderPoint.findUnique.mockResolvedValue(baseReorderPoint);
      await service.remove('rp-1');
      const data = prisma.reorderPoint.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('checkStockLevels', () => {
    it('creates alert + notifies owners when stock ≤ minQuantity', async () => {
      prisma.reorderPoint.findMany.mockResolvedValue([baseReorderPoint]);
      prisma.product.count.mockResolvedValue(1); // 1 ≤ 3 → low
      prisma.user.findMany
        .mockResolvedValueOnce([{ email: 'owner@test', name: 'Owner' }]) // owners
        .mockResolvedValueOnce([]); // branch managers

      const result = await service.checkStockLevels();

      expect(result.alertsCreated).toBe(1);
      expect(prisma.stockAlert.create).toHaveBeenCalled();
      expect(notifications.send).toHaveBeenCalled();
    });

    it('skips alert when stock is healthy (> minQuantity)', async () => {
      prisma.reorderPoint.findMany.mockResolvedValue([baseReorderPoint]);
      prisma.product.count.mockResolvedValue(10); // > 3
      const result = await service.checkStockLevels();
      expect(result.alertsCreated).toBe(0);
      expect(prisma.stockAlert.create).not.toHaveBeenCalled();
    });

    it('skips duplicate — already ACTIVE alert exists', async () => {
      prisma.reorderPoint.findMany.mockResolvedValue([baseReorderPoint]);
      prisma.product.count.mockResolvedValue(1);
      prisma.stockAlert.findFirst.mockResolvedValue({ id: 'alert-existing' });
      const result = await service.checkStockLevels();
      expect(result.alertsCreated).toBe(0);
      expect(prisma.stockAlert.create).not.toHaveBeenCalled();
    });

    it('returns 0 when no reorder points configured', async () => {
      prisma.reorderPoint.findMany.mockResolvedValue([]);
      const result = await service.checkStockLevels();
      expect(result).toEqual({ alertsCreated: 0, notificationsSent: 0 });
    });
  });
});
