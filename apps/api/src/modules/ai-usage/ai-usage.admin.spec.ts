import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AiUsageService } from './ai-usage.service';
import { AiUsageController } from './ai-usage.controller';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

/**
 * Covers the admin-facing query surface of AiUsageService (summary, breakdown,
 * trend, logs) plus wiring through AiUsageController. `record()` is already
 * covered in ai-usage.service.spec.ts.
 */
describe('AiUsage admin queries', () => {
  let service: AiUsageService;
  let controller: AiUsageController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const mkPrisma = () => ({
    aiUsageLog: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  });

  beforeEach(async () => {
    prisma = mkPrisma();
    const mod = await Test.createTestingModule({
      controllers: [AiUsageController],
      providers: [
        AiUsageService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => '25' } },
      ],
    }).compile();

    service = mod.get(AiUsageService);
    controller = mod.get(AiUsageController);
  });

  describe('getSummary', () => {
    const setupHappyPath = (overrides: Partial<Record<string, unknown>> = {}) => {
      prisma.aiUsageLog.aggregate
        .mockResolvedValueOnce({
          _sum: {
            costUsd: new Prisma.Decimal('5.1234'),
            inputTokens: 150_000,
            outputTokens: 30_000,
          },
          _count: 42,
          ...(overrides.today as object),
        })
        .mockResolvedValueOnce({
          _sum: { costUsd: new Prisma.Decimal('12.5') },
          _count: 310,
        })
        .mockResolvedValueOnce({
          _sum: { costUsd: new Prisma.Decimal('48.75') },
          _count: 1_230,
        });
      prisma.aiUsageLog.groupBy.mockResolvedValue([
        { service: 'finance-ai', _sum: { costUsd: new Prisma.Decimal('3.1') }, _count: 25 },
        { service: 'vision-slip', _sum: { costUsd: new Prisma.Decimal('2.02') }, _count: 17 },
      ]);
      prisma.aiUsageLog.count.mockResolvedValue(3);
    };

    it('computes percent used vs configured daily budget', async () => {
      setupHappyPath();
      const res = await service.getSummary();

      expect(res.budget.dailyUsd).toBe(25);
      expect(res.budget.todayUsd).toBeCloseTo(5.1234, 4);
      expect(res.budget.percentUsed).toBeCloseTo((5.1234 / 25) * 100, 4);
      expect(res.budget.breached).toBe(false);
      expect(res.budget.alertThreshold).toBe(20);
    });

    it('flags breached=true when today > budget', async () => {
      prisma.aiUsageLog.aggregate
        .mockResolvedValueOnce({
          _sum: { costUsd: new Prisma.Decimal('30'), inputTokens: 1, outputTokens: 1 },
          _count: 99,
        })
        .mockResolvedValueOnce({ _sum: { costUsd: new Prisma.Decimal('30') }, _count: 99 })
        .mockResolvedValueOnce({ _sum: { costUsd: new Prisma.Decimal('30') }, _count: 99 });
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      prisma.aiUsageLog.count.mockResolvedValue(0);

      const res = await service.getSummary();
      expect(res.budget.breached).toBe(true);
      expect(res.budget.percentUsed).toBeCloseTo(120, 2);
    });

    it('reports today error rate as percentage of today calls', async () => {
      setupHappyPath();
      const res = await service.getSummary();

      expect(res.today.errorCount).toBe(3);
      expect(res.today.errorRate).toBeCloseTo((3 / 42) * 100, 4);
    });

    it('returns errorRate=0 when today has no calls', async () => {
      prisma.aiUsageLog.aggregate
        .mockResolvedValueOnce({
          _sum: { costUsd: null, inputTokens: null, outputTokens: null },
          _count: 0,
        })
        .mockResolvedValueOnce({ _sum: { costUsd: null }, _count: 0 })
        .mockResolvedValueOnce({ _sum: { costUsd: null }, _count: 0 });
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      prisma.aiUsageLog.count.mockResolvedValue(0);

      const res = await service.getSummary();
      expect(res.today.calls).toBe(0);
      expect(res.today.errorRate).toBe(0);
      expect(res.today.costUsd).toBe(0);
    });

    it('rolls up by-service breakdown with numeric cost', async () => {
      setupHappyPath();
      const res = await service.getSummary();

      expect(res.todayByService).toHaveLength(2);
      expect(res.todayByService[0]).toEqual({ service: 'finance-ai', calls: 25, costUsd: 3.1 });
    });

    it('returns 7-day and 30-day totals as numbers', async () => {
      setupHappyPath();
      const res = await service.getSummary();

      expect(res.sevenDays.costUsd).toBeCloseTo(12.5, 4);
      expect(res.sevenDays.calls).toBe(310);
      expect(res.thirtyDays.costUsd).toBeCloseTo(48.75, 4);
      expect(res.thirtyDays.calls).toBe(1_230);
    });

    it('treats null _sum.costUsd as zero', async () => {
      prisma.aiUsageLog.aggregate
        .mockResolvedValueOnce({
          _sum: { costUsd: null, inputTokens: null, outputTokens: null },
          _count: 1,
        })
        .mockResolvedValueOnce({ _sum: { costUsd: null }, _count: 0 })
        .mockResolvedValueOnce({ _sum: { costUsd: null }, _count: 0 });
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      prisma.aiUsageLog.count.mockResolvedValue(0);

      const res = await service.getSummary();
      expect(res.today.costUsd).toBe(0);
      expect(res.sevenDays.costUsd).toBe(0);
      expect(res.thirtyDays.costUsd).toBe(0);
    });
  });

  describe('getBreakdown', () => {
    it('groups by service by default and sorts desc by cost', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([
        {
          service: 'chatbot',
          _sum: { costUsd: new Prisma.Decimal('1'), inputTokens: 100, outputTokens: 50 },
          _count: 10,
        },
        {
          service: 'finance-ai',
          _sum: { costUsd: new Prisma.Decimal('5'), inputTokens: 500, outputTokens: 200 },
          _count: 20,
        },
      ]);

      const rows = await service.getBreakdown({ groupBy: 'service' });
      expect(prisma.aiUsageLog.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['service'] }),
      );
      expect(rows[0].key).toBe('finance-ai');
      expect(rows[0].costUsd).toBe(5);
      expect(rows[1].key).toBe('chatbot');
    });

    it('switches the groupBy column to model when asked', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([
        {
          model: 'claude-haiku-4-5',
          _sum: { costUsd: new Prisma.Decimal('0.5'), inputTokens: 1, outputTokens: 1 },
          _count: 3,
        },
      ]);

      const rows = await service.getBreakdown({ groupBy: 'model' });
      expect(prisma.aiUsageLog.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['model'] }),
      );
      expect(rows[0].key).toBe('claude-haiku-4-5');
    });

    it('coerces null userId rows into "system" label', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([
        { userId: null, _sum: { costUsd: new Prisma.Decimal('2') }, _count: 1 },
        { userId: 'u-1', _sum: { costUsd: new Prisma.Decimal('3') }, _count: 2 },
      ]);

      const rows = await service.getBreakdown({ groupBy: 'user' });
      expect(rows[0].key).toBe('u-1');
      expect(rows[1].key).toBe('system');
    });

    it('defaults to last-30-days window when from/to omitted', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      await service.getBreakdown({ groupBy: 'service' });

      const call = prisma.aiUsageLog.groupBy.mock.calls[0][0];
      expect(call.where.createdAt).toBeDefined();
      expect(call.where.createdAt.gte).toBeInstanceOf(Date);
    });

    it('honors explicit from/to window เป็นวันตามปฏิทินไทย (00:00 น. วันเริ่ม — 23:59:59.999 น. วันสิ้นสุด)', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      await service.getBreakdown({
        groupBy: 'service',
        from: '2026-03-01',
        to: '2026-03-31',
      });
      const call = prisma.aiUsageLog.groupBy.mock.calls[0][0];
      expect(call.where.createdAt.gte.toISOString()).toBe('2026-02-28T17:00:00.000Z');
      expect(call.where.createdAt.lte.toISOString()).toBe('2026-03-31T16:59:59.999Z');
    });

    it('ขอบ: เรียก 00:00 น. ไทยของวันเริ่มอยู่ในช่วง · 00:00 น. ของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      await service.getBreakdown({ groupBy: 'service', from: '2026-11-01', to: '2026-11-17' });
      const { gte, lte } = prisma.aiUsageLog.groupBy.mock.calls[0][0].where.createdAt;
      const firstInstant = new Date('2026-11-01T00:00:00+07:00').getTime();
      const nextDayMidnight = new Date('2026-11-18T00:00:00+07:00').getTime();
      expect(firstInstant >= gte.getTime() && firstInstant <= lte.getTime()).toBe(true);
      expect(nextDayMidnight <= lte.getTime()).toBe(false);
    });

    it('from/to ที่เป็น ISO เต็ม ใช้ตามเดิม', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      await service.getBreakdown({
        groupBy: 'service',
        from: '2026-03-01T03:00:00.000Z',
        to: '2026-03-31T10:00:00.000Z',
      });
      const call = prisma.aiUsageLog.groupBy.mock.calls[0][0];
      expect(call.where.createdAt.gte.toISOString()).toBe('2026-03-01T03:00:00.000Z');
      expect(call.where.createdAt.lte.toISOString()).toBe('2026-03-31T10:00:00.000Z');
    });
  });

  describe('getDailyTrend', () => {
    it('returns exactly N day buckets even when db has no rows', async () => {
      prisma.aiUsageLog.findMany.mockResolvedValue([]);
      const res = await service.getDailyTrend(7);
      expect(res).toHaveLength(7);
      expect(res.every((r) => r.costUsd === 0)).toBe(true);
      expect(res.every((r) => r.calls === 0)).toBe(true);
    });

    it('sums rows into matching day bucket (วันไทย)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T18:30:00.000Z')); // 2026-11-19 01:30 น. ไทย
      try {
        const sameDay = new Date('2026-11-18T10:00:00.000Z'); // 17:00 น. ไทยของวันที่ 18
        prisma.aiUsageLog.findMany.mockResolvedValue([
          { createdAt: sameDay, costUsd: new Prisma.Decimal('1.5'), service: 'finance-ai' },
          { createdAt: sameDay, costUsd: new Prisma.Decimal('0.25'), service: 'chatbot' },
        ]);

        const res = await service.getDailyTrend(3);
        const bucket = res.find((r) => r.date === '2026-11-18');
        expect(bucket).toBeDefined();
        expect(bucket!.costUsd).toBeCloseTo(1.75, 4);
        expect(bucket!.calls).toBe(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('ignores rows outside the requested window', async () => {
      const ancient = new Date('2020-01-01');
      prisma.aiUsageLog.findMany.mockResolvedValue([
        { createdAt: ancient, costUsd: new Prisma.Decimal('99'), service: 'finance-ai' },
      ]);
      const res = await service.getDailyTrend(5);
      expect(res.reduce((s, r) => s + r.costUsd, 0)).toBe(0);
    });
  });

  describe('วันตามเวลาไทย — ปักเวลา 2026-11-19 01:30 น. ไทย (2026-11-18T18:30:00.000Z)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T18:30:00.000Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('getSummary: "วันนี้" เริ่ม 00:00 น. ไทย · 7 วัน/30 วันนับจากเที่ยงคืนไทย (ตรงกับ ai-budget.cron)', async () => {
      prisma.aiUsageLog.aggregate.mockResolvedValue({
        _sum: { costUsd: null, inputTokens: null, outputTokens: null },
        _count: 0,
      });
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      prisma.aiUsageLog.count.mockResolvedValue(0);

      await service.getSummary();

      const gte = (n: number): string =>
        prisma.aiUsageLog.aggregate.mock.calls[n][0].where.createdAt.gte.toISOString();
      expect(gte(0)).toBe('2026-11-18T17:00:00.000Z'); // วันนี้ = 19 พ.ย. 00:00 น. ไทย
      expect(gte(1)).toBe('2026-11-11T17:00:00.000Z'); // 7 วันก่อน
      expect(gte(2)).toBe('2026-10-19T17:00:00.000Z'); // 30 วันก่อน
      expect(prisma.aiUsageLog.groupBy.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe(
        '2026-11-18T17:00:00.000Z',
      );
      expect(prisma.aiUsageLog.count.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe(
        '2026-11-18T17:00:00.000Z',
      );
    });

    it('getDailyTrend: ช่วงเริ่ม 00:00 น. ไทย และป้ายวันเป็นวันไทย', async () => {
      prisma.aiUsageLog.findMany.mockResolvedValue([]);

      const res = await service.getDailyTrend(3);

      expect(prisma.aiUsageLog.findMany.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe(
        '2026-11-16T17:00:00.000Z',
      );
      expect(res.map((r) => r.date)).toEqual(['2026-11-17', '2026-11-18', '2026-11-19']);
    });

    it('getDailyTrend: เรียก 00:30 น. ไทยนับเป็นวันใหม่ · 23:59:59.999 น. ไทยนับเป็นวันเดิม', async () => {
      prisma.aiUsageLog.findMany.mockResolvedValue([
        { createdAt: new Date('2026-11-18T17:30:00.000Z'), costUsd: new Prisma.Decimal('2'), service: 'a' }, // 19 พ.ย. 00:30 น.
        { createdAt: new Date('2026-11-18T16:59:59.999Z'), costUsd: new Prisma.Decimal('1'), service: 'a' }, // 18 พ.ย. 23:59:59.999 น.
      ]);

      const res = await service.getDailyTrend(3);

      expect(res.find((r) => r.date === '2026-11-19')).toMatchObject({ calls: 1, costUsd: 2 });
      expect(res.find((r) => r.date === '2026-11-18')).toMatchObject({ calls: 1, costUsd: 1 });
    });

    it('getBreakdown ไม่ส่ง from/to: ค่าเริ่มต้น = 30 วันก่อน ตั้งแต่ 00:00 น. ไทย', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);

      await service.getBreakdown({ groupBy: 'service' });

      expect(prisma.aiUsageLog.groupBy.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe(
        '2026-10-19T17:00:00.000Z',
      );
    });
  });

  describe('getLogs', () => {
    it('paginates using skip = (page-1) * limit', async () => {
      prisma.aiUsageLog.findMany.mockResolvedValue([]);
      prisma.aiUsageLog.count.mockResolvedValue(0);

      await service.getLogs({ page: 3, limit: 20 });
      expect(prisma.aiUsageLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
    });

    it('filters by service + status when provided', async () => {
      prisma.aiUsageLog.findMany.mockResolvedValue([]);
      prisma.aiUsageLog.count.mockResolvedValue(0);

      await service.getLogs({ page: 1, limit: 25, service: 'finance-ai', status: 'error' });
      const where = prisma.aiUsageLog.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ service: 'finance-ai', status: 'error' });
    });

    it('serializes Decimal costUsd to number for UI consumption', async () => {
      prisma.aiUsageLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          service: 'finance-ai',
          method: 'reply',
          model: 'claude-haiku-4-5',
          inputTokens: 100,
          outputTokens: 50,
          costUsd: new Prisma.Decimal('0.012345'),
          userId: 'u-1',
          status: 'success',
          errorKind: null,
          createdAt: new Date('2026-04-19T08:00:00Z'),
        },
      ]);
      prisma.aiUsageLog.count.mockResolvedValue(1);

      const res = await service.getLogs({ page: 1, limit: 25 });
      expect(res.data[0].costUsd).toBeCloseTo(0.012345, 6);
      expect(typeof res.data[0].costUsd).toBe('number');
    });

    it('returns total + page + limit so the UI can render pagination', async () => {
      prisma.aiUsageLog.findMany.mockResolvedValue([]);
      prisma.aiUsageLog.count.mockResolvedValue(137);

      const res = await service.getLogs({ page: 2, limit: 50 });
      expect(res.total).toBe(137);
      expect(res.page).toBe(2);
      expect(res.limit).toBe(50);
    });
  });

  describe('AiUsageController', () => {
    it('summary endpoint delegates to service.getSummary', async () => {
      const spy = jest.spyOn(service, 'getSummary').mockResolvedValue({
        budget: {
          dailyUsd: 25,
          todayUsd: 0,
          percentUsed: 0,
          breached: false,
          alertThreshold: 20,
        },
        today: {
          calls: 0,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          errorCount: 0,
          errorRate: 0,
        },
        sevenDays: { calls: 0, costUsd: 0 },
        thirtyDays: { calls: 0, costUsd: 0 },
        todayByService: [],
      });
      await controller.getSummary();
      expect(spy).toHaveBeenCalled();
    });

    it('breakdown endpoint defaults groupBy=service when query param missing', async () => {
      const spy = jest.spyOn(service, 'getBreakdown').mockResolvedValue([]);
      await controller.getBreakdown();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ groupBy: 'service', from: undefined, to: undefined }),
      );
    });

    it('breakdown endpoint forwards groupBy=model query param', async () => {
      const spy = jest.spyOn(service, 'getBreakdown').mockResolvedValue([]);
      await controller.getBreakdown('2026-04-01', '2026-04-19', 'model');
      expect(spy).toHaveBeenCalledWith({
        from: '2026-04-01',
        to: '2026-04-19',
        groupBy: 'model',
      });
    });

    it('trend endpoint clamps days to [1, 90]', async () => {
      const spy = jest.spyOn(service, 'getDailyTrend').mockResolvedValue([]);

      await controller.getTrend('180');
      expect(spy).toHaveBeenLastCalledWith(90);

      await controller.getTrend('0');
      expect(spy).toHaveBeenLastCalledWith(1);

      await controller.getTrend(undefined);
      expect(spy).toHaveBeenLastCalledWith(30);
    });

    it('logs endpoint clamps page (>=1) and limit (<=200)', async () => {
      const spy = jest.spyOn(service, 'getLogs').mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 50,
      });

      await controller.getLogs('-2', '999');
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, limit: 200 }),
      );

      await controller.getLogs(undefined, undefined, 'finance-ai', 'error');
      expect(spy).toHaveBeenLastCalledWith({
        page: 1,
        limit: 50,
        service: 'finance-ai',
        status: 'error',
      });
    });
  });
});
