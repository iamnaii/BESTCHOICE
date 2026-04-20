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
    it('returns products grouped by brand+model with min price + stock count', async () => {
      prisma.product.groupBy.mockResolvedValue([
        { brand: 'Apple', model: 'iPhone 13', _min: { costPrice: 12500 }, _count: { id: 5 } },
        { brand: 'Apple', model: 'iPhone 14', _min: { costPrice: 18000 }, _count: { id: 2 } },
      ]);
      prisma.product.findMany.mockResolvedValue([
        { brand: 'Apple', model: 'iPhone 13', gallery: ['url1'], conditionGrade: 'A' },
        { brand: 'Apple', model: 'iPhone 14', gallery: ['url2'], conditionGrade: 'A' },
      ]);
      prisma.product.findFirst.mockResolvedValue(
        { brand: 'Apple', model: 'iPhone 13', gallery: ['url1'], conditionGrade: 'A' },
      );
      prisma.product.count.mockResolvedValue(7);

      const result = await service.listGroupedByModel({ page: 1, limit: 50 });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].brand).toBe('Apple');
      expect(result.data[0].minPrice).toBe(12500);
      expect(result.data[0].stockCount).toBe(5);
    });
  });

  describe('getProductDetail', () => {
    it('returns single product with units list grouped by tier', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1', brand: 'Apple', model: 'iPhone 13', costPrice: 12500,
        conditionGrade: 'A', gallery: [], gallery360: [], isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        { id: 'u1', conditionGrade: 'A', batteryHealth: 92, costPrice: 13900, gallery: [], gallery360: [], imeiSerial: null },
        { id: 'u2', conditionGrade: 'A', batteryHealth: 95, costPrice: 14200, gallery: [], gallery360: [], imeiSerial: null },
        { id: 'u3', conditionGrade: 'B', batteryHealth: 87, costPrice: 12800, gallery: [], gallery360: [], imeiSerial: null },
      ]);

      const result = await service.getProductDetail('p1');

      expect(result).toBeDefined();
      expect(result!.tiers.A.units).toHaveLength(2);
      expect(result!.tiers.B.units).toHaveLength(1);
      expect(result!.tiers.A.minPrice).toBe(13900);
    });
  });

  describe('smartStockCount', () => {
    it('returns LOW_URGENT for 1-3 stock', () => {
      expect(service.smartStockCount(2)).toEqual({ display: 'เหลือ 2 เครื่อง — ใกล้หมด', tone: 'urgent' });
    });
    it('returns LOW for 4-10 stock', () => {
      expect(service.smartStockCount(7)).toEqual({ display: 'เหลือ 7 เครื่อง', tone: 'low' });
    });
    it('returns AVAILABLE for 10+ stock', () => {
      expect(service.smartStockCount(15)).toEqual({ display: 'ในสต็อก พร้อมส่ง', tone: 'available' });
    });
    it('returns OUT for 0 stock', () => {
      expect(service.smartStockCount(0)).toEqual({ display: 'หมดสต็อก แจ้งเตือนเมื่อมาใหม่', tone: 'out' });
    });
  });
});
