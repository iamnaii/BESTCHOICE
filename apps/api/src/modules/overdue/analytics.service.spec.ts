import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { OverdueAnalyticsService } from './analytics.service';

const mockPrisma = {
  $queryRaw: jest.fn(),
};

const emptyResult = {
  weeklyCollectionRate: [],
  promiseKeptTrend: [],
  dunningActionVolume: [],
  letterDispatchByType: [],
  mdmLockVolume: [],
};

describe('OverdueAnalyticsService', () => {
  let service: OverdueAnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueAnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(OverdueAnalyticsService);
  });

  describe('getAnalytics', () => {
    beforeEach(() => {
      // Each call to $queryRaw returns empty arrays by default
      mockPrisma.$queryRaw.mockResolvedValue([]);
    });

    it('returns all 5 metric arrays in the response shape', async () => {
      const result = await service.getAnalytics({ range: '30d' });
      expect(result.range).toBe('30d');
      expect(Array.isArray(result.weeklyCollectionRate)).toBe(true);
      expect(Array.isArray(result.promiseKeptTrend)).toBe(true);
      expect(Array.isArray(result.dunningActionVolume)).toBe(true);
      expect(Array.isArray(result.letterDispatchByType)).toBe(true);
      expect(Array.isArray(result.mdmLockVolume)).toBe(true);
    });

    it('returns empty arrays (not null) when DB has no data', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const result = await service.getAnalytics({ range: '30d' });
      expect(result).toMatchObject({
        ...emptyResult,
        range: '30d',
      });
    });

    it('caches the result on second call (same range)', async () => {
      await service.getAnalytics({ range: '30d' });
      await service.getAnalytics({ range: '30d' });
      // $queryRaw called 5 times for each metric on first call, 0 on cache hit
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(5);
    });

    it('different range triggers a separate DB query (different cache key)', async () => {
      await service.getAnalytics({ range: '30d' });
      await service.getAnalytics({ range: '90d' });
      // 5 calls for 30d + 5 calls for 90d = 10
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(10);
    });

    it('maps DB rows correctly for weeklyCollectionRate', async () => {
      const weekStart = new Date('2026-04-14T00:00:00.000Z');
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([
          { week_start: weekStart, paid_count: BigInt(8), due_count: BigInt(10) },
        ]) // weeklyCollectionRate
        .mockResolvedValue([]); // rest

      const result = await service.getAnalytics({ range: '30d' });
      expect(result.weeklyCollectionRate).toHaveLength(1);
      expect(result.weeklyCollectionRate[0].paidCount).toBe(8);
      expect(result.weeklyCollectionRate[0].dueCount).toBe(10);
      expect(result.weeklyCollectionRate[0].rate).toBeCloseTo(0.8);
    });
  });
});
