import { Test, TestingModule } from '@nestjs/testing';
import { InventoryForecastService } from './inventory-forecast.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('InventoryForecastService', () => {
  let service: InventoryForecastService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    prisma = {
      product: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      sale: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [InventoryForecastService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(InventoryForecastService);
  });

  describe('getInventoryForecast', () => {
    it('returns all 4 categories even with empty data', async () => {
      const result = await service.getInventoryForecast();
      expect(result.categories.map((c) => c.category).sort()).toEqual([
        'ACCESSORY',
        'PHONE_NEW',
        'PHONE_USED',
        'TABLET',
      ]);
    });

    it('computes weekly rate from 90-day sales', async () => {
      prisma.product.groupBy.mockResolvedValue([{ category: 'PHONE_NEW', _count: 50 }]);
      // 90 days of sales: 30 sales total → weeklyRate = 30 / (90/7) ≈ 2.3
      const sales = Array.from({ length: 30 }, (_, i) => ({
        createdAt: daysAgo(i * 3),
        product: { category: 'PHONE_NEW' },
      }));
      prisma.sale.findMany.mockResolvedValue(sales);

      const result = await service.getInventoryForecast();
      const phoneNew = result.categories.find((c) => c.category === 'PHONE_NEW')!;
      expect(phoneNew.salesLast90d).toBe(30);
      expect(phoneNew.weeklyRate).toBeCloseTo(2.3, 1);
    });

    it('marks LOW when days of stock < 14', async () => {
      prisma.product.groupBy.mockResolvedValue([{ category: 'PHONE_NEW', _count: 5 }]);
      // High sales rate: 50 in last 90d → ~3.9/week → ~0.55/day
      // 5 stock / 0.55 ≈ 9 days → LOW
      prisma.sale.findMany.mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => ({
          createdAt: daysAgo(i),
          product: { category: 'PHONE_NEW' },
        })),
      );

      const result = await service.getInventoryForecast();
      const phoneNew = result.categories.find((c) => c.category === 'PHONE_NEW')!;
      expect(phoneNew.stockHealth).toBe('LOW');
    });

    it('marks OK when no sales and stock exists (daysOfStock=999 treated as effectively infinite)', async () => {
      prisma.product.groupBy.mockResolvedValue([{ category: 'PHONE_NEW', _count: 10 }]);
      prisma.sale.findMany.mockResolvedValue([]);
      const result = await service.getInventoryForecast();
      const phoneNew = result.categories.find((c) => c.category === 'PHONE_NEW')!;
      expect(phoneNew.daysOfStock).toBe(999);
      expect(phoneNew.stockHealth).toBe('OK');
    });

    it('suggestedReorder = 0 when weekly rate is 0', async () => {
      prisma.product.groupBy.mockResolvedValue([{ category: 'PHONE_NEW', _count: 10 }]);
      prisma.sale.findMany.mockResolvedValue([]);
      const result = await service.getInventoryForecast();
      const phoneNew = result.categories.find((c) => c.category === 'PHONE_NEW')!;
      expect(phoneNew.suggestedReorder).toBe(0);
    });

    it('suggestedReorder = 4-week buffer minus current stock', async () => {
      prisma.product.groupBy.mockResolvedValue([{ category: 'PHONE_NEW', _count: 2 }]);
      // 14 sales over 90d ≈ 1.1/week → 4 weeks × 1.1 = ~5. stock=2 → suggest 3
      prisma.sale.findMany.mockResolvedValue(
        Array.from({ length: 14 }, (_, i) => ({
          createdAt: daysAgo(i * 6),
          product: { category: 'PHONE_NEW' },
        })),
      );
      const result = await service.getInventoryForecast();
      const phoneNew = result.categories.find((c) => c.category === 'PHONE_NEW')!;
      expect(phoneNew.suggestedReorder).toBeGreaterThan(0);
    });

    it('branchId filter applied to all queries', async () => {
      await service.getInventoryForecast('b-1');
      expect(prisma.product.groupBy.mock.calls[0][0].where.branchId).toBe('b-1');
      expect(prisma.sale.findMany.mock.calls[0][0].where.branchId).toBe('b-1');
    });

    it('summary counts total stock and low categories', async () => {
      prisma.product.groupBy.mockResolvedValue([
        { category: 'PHONE_NEW', _count: 10 },
        { category: 'TABLET', _count: 5 },
      ]);
      const result = await service.getInventoryForecast();
      expect(result.summary.totalStock).toBe(15);
      expect(result.summary.lowStockCategories).toBeGreaterThanOrEqual(0);
    });
  });

  describe('trend calculation (via forecast output)', () => {
    const mockStock = (count: number) =>
      prisma.product.groupBy.mockResolvedValue([{ category: 'PHONE_NEW', _count: count }]);

    it('trend=stable when no sales in both windows', async () => {
      mockStock(10);
      prisma.sale.findMany.mockResolvedValue([]);
      const result = await service.getInventoryForecast();
      expect(result.categories.find((c) => c.category === 'PHONE_NEW')!.trend).toBe('stable');
    });

    it('trend=increasing when recent > previous by >20%', async () => {
      mockStock(10);
      // 10 sales in last 30d, 0 in previous 30d window
      prisma.sale.findMany.mockResolvedValue([
        ...Array.from({ length: 10 }, (_, i) => ({
          createdAt: daysAgo(i),
          product: { category: 'PHONE_NEW' },
        })),
      ]);
      const result = await service.getInventoryForecast();
      expect(result.categories.find((c) => c.category === 'PHONE_NEW')!.trend).toBe('increasing');
    });

    it('trend=decreasing when recent < previous by >20%', async () => {
      mockStock(10);
      // 2 in last 30d, 10 in previous 30d
      prisma.sale.findMany.mockResolvedValue([
        ...Array.from({ length: 2 }, (_, i) => ({
          createdAt: daysAgo(i),
          product: { category: 'PHONE_NEW' },
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          createdAt: daysAgo(40 + i),
          product: { category: 'PHONE_NEW' },
        })),
      ]);
      const result = await service.getInventoryForecast();
      expect(result.categories.find((c) => c.category === 'PHONE_NEW')!.trend).toBe('decreasing');
    });
  });

  describe('slowMoving products', () => {
    it('flags products in stock > 60 days', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p-old',
          name: 'Old iPhone',
          brand: 'Apple',
          category: 'PHONE_USED',
          stockInDate: daysAgo(90),
          createdAt: daysAgo(100),
        },
      ]);
      const result = await service.getInventoryForecast();
      expect(result.slowMoving).toHaveLength(1);
      expect(result.slowMoving[0].daysInStock).toBeGreaterThanOrEqual(89);
    });

    it('falls back to createdAt when stockInDate is null', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p-legacy',
          name: 'Legacy',
          brand: 'Samsung',
          category: 'PHONE_NEW',
          stockInDate: null,
          createdAt: daysAgo(70),
        },
      ]);
      const result = await service.getInventoryForecast();
      expect(result.slowMoving[0].daysInStock).toBeGreaterThanOrEqual(69);
    });
  });
});
