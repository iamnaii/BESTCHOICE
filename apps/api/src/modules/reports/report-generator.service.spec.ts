import { Prisma } from '@prisma/client';
import { ReportGeneratorService } from './report-generator.service';

/**
 * รายงานสรุปที่ cron สร้าง (2026-11-18): ป้ายวันต้องเป็นวันตามปฏิทินไทยที่ cron รัน ไม่ใช่วันที่ UTC ของเที่ยงคืนไทย
 * เดิม cron 23:55 น. ของวันที่ 18 เก็บเป็น daily_report_2026-11-17
 * ปั้น prisma ด้วยมือแบบ reports.aggregations.spec.ts · จำลองเวลาเฉพาะ Date
 */
const FAKE_DATE_ONLY = [
  'nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance',
] as const;

function make() {
  const prisma = {
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountPaid: new Prisma.Decimal('1234.40') }, _count: 2 }),
      count: jest.fn().mockResolvedValue(3),
    },
    contract: { count: jest.fn().mockResolvedValue(1) },
    customer: { count: jest.fn().mockResolvedValue(4) },
    systemConfig: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) =>
        Promise.resolve({
          key: where.key,
          value: JSON.stringify({ date: where.key.replace('daily_report_', ''), revenue: 100, paymentsCount: 1 }),
        }),
      ),
    },
  };
  return { prisma, svc: new ReportGeneratorService(prisma as never, {} as never) };
}

describe('ReportGeneratorService.generateDailySummary — ป้ายวัน + หน้าต่างวันตามเวลาไทย', () => {
  it('cron 23:55 น. ของวันที่ 18 → key/summary.date = 2026-11-18 และหน้าต่าง [00:00 วันที่ 18, 00:00 วันที่ 19)', async () => {
    const { prisma, svc } = make();

    const summary = await svc.generateDailySummary(new Date('2026-11-18T16:55:00.000Z'));

    expect(summary.date).toBe('2026-11-18');
    expect(prisma.systemConfig.upsert.mock.calls[0][0].where.key).toBe('daily_report_2026-11-18');
    const window = {
      gte: new Date('2026-11-17T17:00:00.000Z'),
      lt: new Date('2026-11-18T17:00:00.000Z'),
    };
    expect(prisma.payment.aggregate.mock.calls[0][0].where.paidDate).toEqual(window);
    expect(prisma.contract.count.mock.calls[0][0].where.createdAt).toEqual(window);
    expect(prisma.customer.count.mock.calls[0][0].where.createdAt).toEqual(window);
    expect(prisma.payment.count.mock.calls[0][0].where.dueDate).toEqual({ lt: window.gte });
  });

  it('รันหลังเที่ยงคืน (01:05 น. ของวันที่ 18) → ยังเป็นวันที่ 18 ตามปฏิทินไทย', async () => {
    const { prisma, svc } = make();

    const summary = await svc.generateDailySummary(new Date('2026-11-17T18:05:00.000Z'));

    expect(summary.date).toBe('2026-11-18');
    expect(prisma.systemConfig.upsert.mock.calls[0][0].where.key).toBe('daily_report_2026-11-18');
  });
});

describe('ReportGeneratorService.generateWeeklySummary — รวมวันจันทร์..อาทิตย์ที่แล้ว ตามป้ายวันจริง', () => {
  afterEach(() => jest.useRealTimers());

  it('จันทร์ 23 พ.ย. 00:05 น. → อ่าน daily_report_2026-11-16 .. 2026-11-22 · weekStart 2026-11-16 · weekEnd 2026-11-22', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-22T17:05:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    const { prisma, svc } = make();

    const summary = await svc.generateWeeklySummary();

    expect(prisma.systemConfig.findUnique.mock.calls.map((c: [{ where: { key: string } }]) => c[0].where.key)).toEqual([
      'daily_report_2026-11-16',
      'daily_report_2026-11-17',
      'daily_report_2026-11-18',
      'daily_report_2026-11-19',
      'daily_report_2026-11-20',
      'daily_report_2026-11-21',
      'daily_report_2026-11-22',
    ]);
    expect(summary.weekStart).toBe('2026-11-16');
    expect(summary.weekEnd).toBe('2026-11-22');
    expect(summary.totalRevenue).toBe(700);
    expect(prisma.systemConfig.upsert.mock.calls[0][0].where.key).toBe('weekly_report_2026-11-16');
  });
});
