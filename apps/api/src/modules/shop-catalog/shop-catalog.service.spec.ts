import { Test } from '@nestjs/testing';
import { ShopCatalogService } from './shop-catalog.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopCatalogService', () => {
  let service: ShopCatalogService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        groupBy: jest.fn(),
        count: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [ShopCatalogService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopCatalogService);
  });

  describe('listGroupedByModel', () => {
    it('hard-filters to iPhone only (brand=Apple AND category in phone set)', async () => {
      prisma.product.groupBy.mockResolvedValue([]);

      await service.listGroupedByModel({});

      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['brand', 'model', 'storage', 'category'],
          where: expect.objectContaining({
            brand: 'Apple',
            category: { in: ['PHONE_NEW', 'PHONE_USED'] },
            isOnlineVisible: true,
            status: 'IN_STOCK',
            deletedAt: null,
          }),
        }),
      );
    });

    it('narrows category to PHONE_NEW when condition=NEW', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ condition: 'NEW' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.category).toBe('PHONE_NEW');
    });

    it('narrows category to PHONE_USED when condition=USED', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ condition: 'USED' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.category).toBe('PHONE_USED');
    });

    it('groups by category so new+used of same model are separate cards, with condition + cashPrice', async () => {
      prisma.product.groupBy.mockResolvedValue([
        {
          brand: 'Apple',
          model: 'iPhone 16',
          storage: '128GB',
          category: 'PHONE_NEW',
          _min: { cashPrice: 29900 },
          _count: { id: 3 },
        },
        {
          brand: 'Apple',
          model: 'iPhone 16',
          storage: '128GB',
          category: 'PHONE_USED',
          _min: { cashPrice: 19900 },
          _count: { id: 2 },
        },
      ]);
      prisma.product.findFirst.mockResolvedValue({
        id: 'rep',
        gallery: ['u'],
        conditionGrade: null,
      });

      const result = await service.listGroupedByModel({});

      expect(result.data).toHaveLength(2);
      expect(result.data[0].condition).toBe('NEW');
      expect(result.data[0].minPrice).toBe(29900);
      expect(result.data[1].condition).toBe('USED');
      expect(result.data[1].minPrice).toBe(19900);
    });

    it('uses cashPrice (not costPrice) for min/sort and never leaks costPrice', async () => {
      prisma.product.groupBy.mockResolvedValue([
        {
          brand: 'Apple',
          model: 'iPhone 15',
          storage: null,
          category: 'PHONE_USED',
          _min: { cashPrice: 16900 },
          _count: { id: 1 },
        },
      ]);
      prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'A' });

      const result = await service.listGroupedByModel({ sort: 'price_asc' });

      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ _min: { cashPrice: true } }),
      );
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { cashPrice: 'asc' } }),
      );
      expect(JSON.stringify(result.data)).not.toContain('costPrice');
    });

    it('returns minPrice=null (no costPrice fallback) when cashPrice unset', async () => {
      prisma.product.groupBy.mockResolvedValue([
        {
          brand: 'Apple',
          model: 'iPhone 12',
          storage: '64GB',
          category: 'PHONE_USED',
          _min: { cashPrice: null },
          _count: { id: 1 },
        },
      ]);
      prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'B' });

      const result = await service.listGroupedByModel({});

      expect(result.data[0].minPrice).toBeNull();
      expect(result.data[0].monthlyPaymentFrom).toBe(0);
    });

    it('filters by search text on brand OR model (case-insensitive)', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: ' iphone 15 ' });
      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { brand: { contains: 'iphone 15', mode: 'insensitive' } },
              { model: { contains: 'iphone 15', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('ignores a blank search string', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: '   ' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });
  });

  describe('getProductDetail', () => {
    it('scopes units to the SAME category as the clicked card (no new/used mix)', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        category: 'PHONE_USED',
        cashPrice: 13900,
        conditionGrade: 'A',
        gallery: [],
        gallery360: [],
        isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'u1',
          conditionGrade: 'A',
          batteryHealth: 92,
          cashPrice: 13900,
          gallery: [],
          gallery360: [],
          imeiSerial: null,
        },
        {
          id: 'u2',
          conditionGrade: 'B',
          batteryHealth: 87,
          cashPrice: 12800,
          gallery: [],
          gallery360: [],
          imeiSerial: null,
        },
      ]);

      const result = await service.getProductDetail('p1');

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ category: 'PHONE_USED' }) }),
      );
      expect(result!.condition).toBe('USED');
      expect(result!.tiers.A.units).toHaveLength(1);
      expect(result!.tiers.A.minPrice).toBe(13900);
      expect(JSON.stringify(result)).not.toContain('costPrice');
    });

    it('reports condition=NEW for a brand-new phone', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p2',
        brand: 'Apple',
        model: 'iPhone 16',
        storage: '128GB',
        category: 'PHONE_NEW',
        cashPrice: 29900,
        conditionGrade: null,
        gallery: [],
        gallery360: [],
        isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'n1',
          conditionGrade: null,
          cashPrice: 29900,
          gallery: [],
          gallery360: [],
          imeiSerial: null,
        },
      ]);

      const result = await service.getProductDetail('p2');
      expect(result!.condition).toBe('NEW');
    });
  });

  describe('smartStockCount', () => {
    it('returns LOW_URGENT for 1-3 stock', () => {
      expect(service.smartStockCount(2)).toEqual({
        display: 'เหลือ 2 เครื่อง — ใกล้หมด',
        tone: 'urgent',
      });
    });
    it('returns LOW for 4-10 stock', () => {
      expect(service.smartStockCount(7)).toEqual({ display: 'เหลือ 7 เครื่อง', tone: 'low' });
    });
    it('returns AVAILABLE for 10+ stock', () => {
      expect(service.smartStockCount(15)).toEqual({
        display: 'ในสต็อก พร้อมส่ง',
        tone: 'available',
      });
    });
    it('returns OUT for 0 stock', () => {
      expect(service.smartStockCount(0)).toEqual({
        display: 'หมดสต็อก แจ้งเตือนเมื่อมาใหม่',
        tone: 'out',
      });
    });
  });
});
