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
      // readBoolFlag('shop_hide_demo_products') reads this — most tests don't care and leave it
      // unmocked (undefined return → readRawValue catches → default false, matches prod day-1).
      systemConfig: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [ShopCatalogService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopCatalogService);
  });

  describe('listGroupedByModel', () => {
    it('hard-filters ผ่าน readiness fragment (brand/category/สถานะ/ราคา/รูป) และกรอง [DEMO] เมื่อเปิด flag shop_hide_demo_products', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
      prisma.product.groupBy.mockResolvedValue([]);

      await service.listGroupedByModel({});

      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { brand: 'Apple' },
          { category: { in: ['PHONE_NEW', 'PHONE_USED'] } },
          { isOnlineVisible: true },
          { status: 'IN_STOCK' },
          { deletedAt: null },
          { cashPrice: { gt: 0 } },
          { gallery: { isEmpty: false } },
          { NOT: { name: { startsWith: '[DEMO]' } } },
        ]),
      );
    });

    it('ไม่กรอง [DEMO] เมื่อไม่ได้เปิด flag shop_hide_demo_products (default — เว็บยังโชว์สินค้าตัวอย่างจนกว่า owner จะกรอกของจริง)', async () => {
      prisma.product.groupBy.mockResolvedValue([]);

      await service.listGroupedByModel({});

      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { brand: 'Apple' },
          { category: { in: ['PHONE_NEW', 'PHONE_USED'] } },
          { isOnlineVisible: true },
          { status: 'IN_STOCK' },
          { deletedAt: null },
          { cashPrice: { gt: 0 } },
          { gallery: { isEmpty: false } },
        ]),
      );
      expect(where.AND).not.toContainEqual({ NOT: { name: { startsWith: '[DEMO]' } } });
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
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'PHONE_NEW' }),
        }),
      );
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
      expect(result.data[0].monthlyPaymentFrom).toBeNull();
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

    it('filters by exact model while keeping the iPhone-only base', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ model: 'iPhone 16' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.model).toBe('iPhone 16');
      expect(where.AND).toEqual(
        expect.arrayContaining([{ brand: 'Apple' }, { status: 'IN_STOCK' }]),
      );
    });

    it('search assign where.OR แล้ว readiness fragment ยังอยู่ครบ (ไม่โดนทับ)', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: 'iphone 15' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.OR).toHaveLength(2);
      expect(where.AND).toEqual(expect.arrayContaining([{ cashPrice: { gt: 0 } }]));
    });
  });

  describe('listAvailableModels', () => {
    it('returns distinct models with counts, iPhone-only base, sorted by count desc', async () => {
      prisma.product.groupBy.mockResolvedValue([
        { model: 'iPhone 16', _count: { id: 5 } },
        { model: 'iPhone 15', _count: { id: 2 } },
      ]);

      const result = await service.listAvailableModels();

      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['model'],
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ brand: 'Apple' }, { status: 'IN_STOCK' }, { deletedAt: null }]),
          }),
          orderBy: [{ _count: { id: 'desc' } }],
        }),
      );
      expect(result).toEqual([
        { model: 'iPhone 16', count: 5 },
        { model: 'iPhone 15', count: 2 },
      ]);
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
        costPrice: 9999,
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
          costPrice: 9999,
          gallery: [],
          gallery360: [],
          imeiSerial: null,
        },
        {
          id: 'u2',
          conditionGrade: 'B',
          batteryHealth: 87,
          cashPrice: 12800,
          costPrice: 9999,
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

      // Fix round 1/5 (Minor): pin the permalink invariant on BOTH halves — head query
      // (requireInStock:false) must NOT force IN_STOCK, units query (default) MUST.
      // Without this a regression that flips either half silently breaks the permalink
      // (sold unit's page 404s) or breaks the catalog gate (sold units listed as buyable).
      const headWhere = prisma.product.findFirst.mock.calls[0][0].where;
      expect(headWhere.AND).not.toContainEqual({ status: 'IN_STOCK' });
      const unitsWhere = prisma.product.findMany.mock.calls[0][0].where;
      expect(unitsWhere.AND).toContainEqual({ status: 'IN_STOCK' });
    });

    it('returns null when the resolved id is not an iPhone (brand/category guard on the initial lookup)', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      const result = await service.getProductDetail('non-iphone-id');

      expect(result).toBeNull();
      const where = prisma.product.findFirst.mock.calls[0][0].where;
      expect(where.id).toBe('non-iphone-id');
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { brand: 'Apple' },
          { category: { in: ['PHONE_NEW', 'PHONE_USED'] } },
        ]),
      );
      // permalink: ไม่บังคับ IN_STOCK ที่ head query
      expect(where.AND).not.toContainEqual({ status: 'IN_STOCK' });
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

    it('returns per-unit color and installmentPrice', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '128GB',
        color: 'Black',
        category: 'PHONE_USED',
        cashPrice: 15900,
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
          hasBox: true,
          shopWarrantyDays: 30,
          color: 'Blue',
          cashPrice: 15900,
          installmentPrice: 17500,
          imeiSerial: '111122223333',
          gallery: [],
          gallery360: [],
        },
      ]);
      const result = await service.getProductDetail('p1');
      const u = result!.tiers.A.units[0];
      expect(u.color).toBe('Blue');
      expect(u.installmentPrice).toBe(17500);
      expect(JSON.stringify(result)).not.toContain('costPrice');
    });

    describe('getProductDetail — ราคา null (B0)', () => {
      it('ตัด unit ที่ไม่มี cashPrice ออกแทนการโชว์ 0', async () => {
        prisma.product.findFirst.mockResolvedValue({
          id: 'p1',
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          category: 'PHONE_NEW',
          color: null,
          onlineDescription: null,
          gallery: ['g'],
          gallery360: [],
          cashPrice: '28900',
          installmentPrice: null,
        });
        prisma.product.findMany.mockResolvedValue([
          {
            id: 'u1',
            conditionGrade: null,
            cashPrice: '28900',
            installmentPrice: null,
            gallery: [],
            gallery360: [],
            imeiSerial: null,
            batteryHealth: null,
            hasBox: null,
            color: null,
            shopWarrantyDays: null,
          },
          {
            id: 'u2',
            conditionGrade: null,
            cashPrice: null,
            installmentPrice: null,
            gallery: [],
            gallery360: [],
            imeiSerial: null,
            batteryHealth: null,
            hasBox: null,
            color: null,
            shopWarrantyDays: null,
          },
        ]);

        const detail = await service.getProductDetail('p1');
        const units = Object.values(detail!.tiers).flatMap((t) => t.units);
        expect(units.map((u) => u.id)).toEqual(['u1']);
      });
    });
  });

  describe('listRelated', () => {
    it('returns other models (iPhone-only base, excludes current model, limit 6)', async () => {
      prisma.product.findFirst.mockResolvedValueOnce({ id: 'p1', model: 'iPhone 16' });
      prisma.product.groupBy.mockResolvedValue([
        {
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          category: 'PHONE_USED',
          _min: { cashPrice: 14000 },
          _count: { id: 2 },
        },
      ]);
      prisma.product.findFirst.mockResolvedValueOnce({
        id: 'rep',
        gallery: [],
        conditionGrade: 'A',
      });

      const result = await service.listRelated('p1');

      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['brand', 'model', 'storage', 'category'],
          where: expect.objectContaining({
            model: { not: 'iPhone 16' },
            AND: expect.arrayContaining([{ brand: 'Apple' }]),
          }),
          take: 6,
        }),
      );
      expect(result[0].model).toBe('iPhone 15');
      // head lookup ของ listRelated ไม่บังคับ IN_STOCK (permalink ของเครื่องที่ขายแล้ว)
      expect(prisma.product.findFirst.mock.calls[0][0].where.AND).not.toContainEqual({
        status: 'IN_STOCK',
      });
    });

    it('returns [] when product not found', async () => {
      prisma.product.findFirst.mockResolvedValueOnce(null);
      expect(await service.listRelated('missing')).toEqual([]);
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
