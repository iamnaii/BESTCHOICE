import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

/**
 * CHARACTERIZATION (golden) spec for AnalyticsService.
 *
 * Pins the CURRENT behavior of the hand-rolled linear-regression revenue
 * forecast and the cohort-retention bucketing. These power the customer-facing
 * OWNER dashboard (`GET /reports/revenue-forecast`, `GET /reports/cohort-analysis`).
 * Values asserted below were computed from the existing implementation, NOT from
 * an independent reference — if the math changes, these golden values must change
 * too (that is the point of a characterization test).
 *
 * Both methods read exclusively from prisma.$queryRaw, so we mock it. The service
 * passes a single Prisma.sql argument, which the mock ignores; we drive behavior
 * purely via the resolved value.
 */
const mockPrisma = {
  $queryRaw: jest.fn(),
};

describe('AnalyticsService (characterization)', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AnalyticsService);
  });

  // -------------------------------------------------------------------------
  // getRevenueForecast — linear regression y = a + b*x
  // -------------------------------------------------------------------------
  describe('getRevenueForecast', () => {
    /**
     * KNOWN dataset (amount comes back as a string from `SUM(...)::text`, then
     * passed through d(...).toNumber()):
     *   x:      0        1        2        3
     *   y: 100000   150000   170000   220000
     *
     * Hand-derived golden values from the implementation:
     *   slope b      = 38000
     *   intercept a  = 103000
     *   residuals    = [-3000, 9000, -9000, 3000]
     *   SSE          = 180_000_000
     *   stdError     = sqrt(SSE / (n-2)) = sqrt(180000000/2) = 9486.832980505138
     *   margin       = 1.28 * stdError   = 12143.146215046578
     */
    const KNOWN_ROWS = [
      { month: '2026-01', amount: '100000' },
      { month: '2026-02', amount: '150000' },
      { month: '2026-03', amount: '170000' },
      { month: '2026-04', amount: '220000' },
    ];

    it('returns the historical series mapped to numbers', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(KNOWN_ROWS);
      const result = await service.getRevenueForecast();
      expect(result.historical).toEqual([
        { month: '2026-01', amount: 100000 },
        { month: '2026-02', amount: 150000 },
        { month: '2026-03', amount: 170000 },
        { month: '2026-04', amount: 220000 },
      ]);
    });

    it('pins slope (b) via trend + the regression-driven forecast amounts', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(KNOWN_ROWS);
      const result = await service.getRevenueForecast();

      // trend reflects sign of slope b (=38000 > 0)
      expect(result.trend).toBe('up');

      // Forecast amounts = Math.round(a + b * x) for x = 4, 5, 6:
      //   a + b*4 = 103000 + 152000 = 255000
      //   a + b*5 = 103000 + 190000 = 293000
      //   a + b*6 = 103000 + 228000 = 331000
      expect(result.forecast.map((f) => f.amount)).toEqual([255000, 293000, 331000]);
    });

    it('pins intercept (a) via monthlyGrowthRate = round((b/a)*100*10)/10', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(KNOWN_ROWS);
      const result = await service.getRevenueForecast();

      // monthlyGrowthRate = Math.round((b / (a || 1)) * 100 * 10) / 10
      //                   = Math.round((38000 / 103000) * 1000) / 10
      //                   = Math.round(368.93) / 10 = 369 / 10 = 36.9
      expect(result.monthlyGrowthRate).toBe(36.9);
    });

    it('pins the next-3-month forecast months from the last historical month', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(KNOWN_ROWS);
      const result = await service.getRevenueForecast();
      expect(result.forecast.map((f) => f.month)).toEqual(['2026-05', '2026-06', '2026-07']);
    });

    it('pins the 80% CI margin (1.28 * stdError) as lower/upper bounds + confidence', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(KNOWN_ROWS);
      const result = await service.getRevenueForecast();

      // margin = 1.28 * 9486.832980505138 = 12143.146215046578
      //   month 1: amount 255000 → lower 242857, upper 267143
      //   month 2: amount 293000 → lower 280857, upper 305143
      //   month 3: amount 331000 → lower 318857, upper 343143
      expect(result.forecast).toEqual([
        { month: '2026-05', amount: 255000, lower: 242857, upper: 267143, confidence: 80 },
        { month: '2026-06', amount: 293000, lower: 280857, upper: 305143, confidence: 80 },
        { month: '2026-07', amount: 331000, lower: 318857, upper: 343143, confidence: 80 },
      ]);
    });

    it('returns the insufficient-data note when fewer than 2 months exist', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ month: '2026-04', amount: '100000' }]);
      const result = await service.getRevenueForecast();
      expect(result.forecast).toEqual([]);
      expect(result.note).toBe(
        'ข้อมูลไม่เพียงพอสำหรับการพยากรณ์ (ต้องการอย่างน้อย 2 เดือน)',
      );
      // trend / monthlyGrowthRate are not present on the short-circuit shape
      expect(result.trend).toBeUndefined();
    });

    it('forces stdError to 0 when n === 2 (margin collapses, lower === upper === amount)', async () => {
      // With exactly 2 points the code uses `n > 2 ? ... : 0` for stdError,
      // so the CI margin is 0 even though residuals would otherwise exist.
      //   x:      0        1
      //   y: 100000   120000  → b = 20000, a = 100000
      //   first forecast x = 2 → 100000 + 40000 = 140000, margin = 0
      mockPrisma.$queryRaw.mockResolvedValue([
        { month: '2026-03', amount: '100000' },
        { month: '2026-04', amount: '120000' },
      ]);
      const result = await service.getRevenueForecast();
      expect(result.trend).toBe('up');
      expect(result.forecast[0]).toEqual({
        month: '2026-05',
        amount: 140000,
        lower: 140000,
        upper: 140000,
        confidence: 80,
      });
    });

    it('clamps negative predictions to 0 (downward trend, Math.max(0, ...))', async () => {
      // Steep downward slope so a far-out forecast goes negative and is clamped.
      //   x:      0        1        2        3
      //   y: 100000    60000    20000        0
      //   b = -34000, a = 96000 → x=6 prediction = 96000 - 204000 = -108000 → 0
      mockPrisma.$queryRaw.mockResolvedValue([
        { month: '2026-01', amount: '100000' },
        { month: '2026-02', amount: '60000' },
        { month: '2026-03', amount: '20000' },
        { month: '2026-04', amount: '0' },
      ]);
      const result = await service.getRevenueForecast();
      expect(result.trend).toBe('down');
      // last forecast month (x=6) is clamped to 0; lower is also clamped to 0
      expect(result.forecast[2].amount).toBe(0);
      expect(result.forecast[2].lower).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getCohortAnalysis — monthly retention buckets
  // -------------------------------------------------------------------------
  describe('getCohortAnalysis', () => {
    /**
     * Small fixture mimicking the raw SQL output rows
     * ({ cohortMonth, offsetMonth, customerCount }):
     *
     *   2026-01: offset0=10, offset1=8, offset2=5
     *   2026-02: offset0=4,  offset1=3   (no offset2 → padded to 0)
     *
     * Retention = Math.round((count / cohortSize) * 100):
     *   2026-01: [100, 80, 50]
     *   2026-02: [100, 75, 0]   (3/4 = 75; missing offset2 → 0)
     */
    const COHORT_ROWS = [
      { cohortMonth: '2026-01', offsetMonth: 0, customerCount: 10 },
      { cohortMonth: '2026-01', offsetMonth: 1, customerCount: 8 },
      { cohortMonth: '2026-01', offsetMonth: 2, customerCount: 5 },
      { cohortMonth: '2026-02', offsetMonth: 0, customerCount: 4 },
      { cohortMonth: '2026-02', offsetMonth: 1, customerCount: 3 },
    ];

    it('pins cohort sizes, retention buckets, and maxOffset', async () => {
      mockPrisma.$queryRaw.mockResolvedValue(COHORT_ROWS);
      const result = await service.getCohortAnalysis();

      expect(result.maxOffset).toBe(2);
      expect(result.cohorts).toEqual([
        { month: '2026-01', customers: 10, retention: [100, 80, 50] },
        { month: '2026-02', customers: 4, retention: [100, 75, 0] },
      ]);
    });

    it('sorts cohorts ascending by month regardless of row order', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { cohortMonth: '2026-02', offsetMonth: 0, customerCount: 4 },
        { cohortMonth: '2026-01', offsetMonth: 0, customerCount: 10 },
      ]);
      const result = await service.getCohortAnalysis();
      expect(result.cohorts.map((c) => c.month)).toEqual(['2026-01', '2026-02']);
    });

    it('returns an empty cohort list (maxOffset 0) when DB has no rows', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const result = await service.getCohortAnalysis();
      expect(result.cohorts).toEqual([]);
      expect(result.maxOffset).toBe(0);
      expect(typeof result.generatedAt).toBe('string');
    });

    it('rounds retention with Math.round (1/3 → 33, half-up at .5)', async () => {
      // size=3, offset1 count=1 → 33.33% → 33; offset2 count=2 → 66.67% → 67
      mockPrisma.$queryRaw.mockResolvedValue([
        { cohortMonth: '2026-01', offsetMonth: 0, customerCount: 3 },
        { cohortMonth: '2026-01', offsetMonth: 1, customerCount: 1 },
        { cohortMonth: '2026-01', offsetMonth: 2, customerCount: 2 },
      ]);
      const result = await service.getCohortAnalysis();
      expect(result.cohorts[0].retention).toEqual([100, 33, 67]);
    });
  });
});
