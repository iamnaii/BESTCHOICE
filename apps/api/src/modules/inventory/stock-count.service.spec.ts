import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StockCountService } from './stock-count.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('StockCountService', () => {
  let service: StockCountService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  const baseStockCount = (overrides: Record<string, unknown> = {}) => ({
    id: 'sc-1',
    countNumber: 'SC-2026-04-001',
    branchId: 'b-1',
    status: 'IN_PROGRESS',
    items: [
      { productId: 'p-1', actualFound: false, product: { id: 'p-1', name: 'iPhone', status: 'IN_STOCK' } },
      { productId: 'p-2', actualFound: false, product: { id: 'p-2', name: 'Samsung', status: 'IN_STOCK' } },
    ],
    branch: { id: 'b-1', name: 'สาขา' },
    notes: null,
    deletedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    tx = {
      stockCount: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn((args) =>
          Promise.resolve({
            id: 'sc-new',
            countNumber: args.data.countNumber,
            ...args.data,
            _count: { items: args.data.items?.create?.length ?? 0 },
          }),
        ),
        update: jest.fn((args) =>
          Promise.resolve({ ...baseStockCount(), ...args.data, items: baseStockCount().items }),
        ),
      },
      stockCountItem: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p-1', status: 'IN_STOCK' },
          { id: 'p-2', status: 'IN_STOCK' },
        ]),
      },
    };
    prisma = {
      stockCount: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn((args) => Promise.resolve({ ...baseStockCount(), ...args.data })),
      },
      branch: {
        findUnique: jest.fn().mockResolvedValue({ id: 'b-1', deletedAt: null }),
      },
      $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [StockCountService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(StockCountService);
  });

  describe('findAll', () => {
    it('applies filters + pagination', async () => {
      await service.findAll({ branchId: 'b-1', status: 'COMPLETED', page: 2, limit: 10 });
      const args = prisma.stockCount.findMany.mock.calls[0][0];
      expect(args.where.branchId).toBe('b-1');
      expect(args.where.status).toBe('COMPLETED');
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
    });

    it('caps limit at 100', async () => {
      await service.findAll({ limit: 999 });
      expect(prisma.stockCount.findMany.mock.calls[0][0].take).toBe(100);
    });
  });

  describe('findOne', () => {
    it('returns stock count with items+product', async () => {
      prisma.stockCount.findUnique.mockResolvedValue(baseStockCount());
      const result = await service.findOne('sc-1');
      expect(result.items).toHaveLength(2);
    });

    it('throws NotFound when missing', async () => {
      prisma.stockCount.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('generates SC-YYYY-MM-NNN count number', async () => {
      tx.stockCount.count.mockResolvedValue(2); // 2 existing this month → new is 003
      await service.create({ branchId: 'b-1' } as Parameters<StockCountService['create']>[0], 'u-1');
      const created = tx.stockCount.create.mock.calls[0][0];
      expect(created.data.countNumber).toMatch(/^SC-\d{4}-\d{2}-003$/);
    });

    it('populates expected items from IN_STOCK/RESERVED/QC_PENDING products', async () => {
      await service.create({ branchId: 'b-1' } as Parameters<StockCountService['create']>[0], 'u-1');
      const where = tx.product.findMany.mock.calls[0][0].where;
      expect(where.status.in).toEqual(['IN_STOCK', 'RESERVED', 'QC_PENDING']);
      const items = tx.stockCount.create.mock.calls[0][0].data.items.create;
      expect(items).toHaveLength(2);
      expect(items[0].actualFound).toBe(false);
    });

    it('throws NotFound when branch missing', async () => {
      prisma.branch.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ branchId: 'missing' } as Parameters<StockCountService['create']>[0], 'u-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('submit', () => {
    const dto = {
      items: [
        { productId: 'p-1', actualFound: true },
        { productId: 'p-2', actualFound: false, conditionNotes: 'missing' },
      ],
    };

    it('updates each item + marks COMPLETED', async () => {
      prisma.stockCount.findUnique.mockResolvedValue(baseStockCount());
      const result = await service.submit('sc-1', dto);
      expect(tx.stockCountItem.updateMany).toHaveBeenCalledTimes(2);
      const updateArgs = tx.stockCount.update.mock.calls[0][0];
      expect(updateArgs.data.status).toBe('COMPLETED');
      expect(updateArgs.data.completedAt).toBeInstanceOf(Date);
      // variance computed from items (both have actualFound=false in baseStockCount)
      expect(result.variance.totalExpected).toBe(2);
    });

    it('rejects already COMPLETED', async () => {
      prisma.stockCount.findUnique.mockResolvedValue(baseStockCount({ status: 'COMPLETED' }));
      await expect(service.submit('sc-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('rejects CANCELLED', async () => {
      prisma.stockCount.findUnique.mockResolvedValue(baseStockCount({ status: 'CANCELLED' }));
      await expect(service.submit('sc-1', dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('sets status=CANCELLED for IN_PROGRESS', async () => {
      prisma.stockCount.findUnique.mockResolvedValue(baseStockCount());
      await service.cancel('sc-1');
      const args = prisma.stockCount.update.mock.calls[0][0];
      expect(args.data.status).toBe('CANCELLED');
    });

    it('throws BadRequest when already COMPLETED', async () => {
      prisma.stockCount.findUnique.mockResolvedValue(baseStockCount({ status: 'COMPLETED' }));
      await expect(service.cancel('sc-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getVariance', () => {
    it('returns counts + missingItems list', async () => {
      prisma.stockCount.findUnique.mockResolvedValue(
        baseStockCount({
          items: [
            { productId: 'p-1', actualFound: true, expectedStatus: 'IN_STOCK', product: { id: 'p-1', name: 'iPhone', imeiSerial: '111' } },
            { productId: 'p-2', actualFound: false, expectedStatus: 'IN_STOCK', product: { id: 'p-2', name: 'Samsung', imeiSerial: '222' } },
            { productId: 'p-3', actualFound: false, expectedStatus: 'RESERVED', product: { id: 'p-3', name: 'Xiaomi', imeiSerial: '333' } },
          ],
        }),
      );
      const result = await service.getVariance('sc-1');
      expect(result.totalExpected).toBe(3);
      expect(result.found).toBe(1);
      expect(result.missingCount).toBe(2);
      expect(result.missingItems.map((m) => m.productId)).toEqual(['p-2', 'p-3']);
    });
  });
});
