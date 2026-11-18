import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { ReportsService } from './reports.service';

/**
 * รายงานใน /reports/* รับวันที่แบบ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม new Date('YYYY-MM-DD') = เที่ยงคืน UTC = 07:00 น. ไทย ⇒ รายการ 00:00–06:59 น. ของวันเริ่มหาย
 * (เช่น ใบจ่ายผ่านเกตเวย์ 03:00 น. · สัญญาที่สร้าง 02:00 น. ของวันที่ 1)
 * รูปแบบ mock ตาม reports.aggregations.spec.ts
 */
const START = new Date('2026-10-31T17:00:00.000Z'); // 2026-11-01 00:00:00.000 น. ไทย
const END = new Date('2026-11-17T16:59:59.999Z'); // 2026-11-17 23:59:59.999 น. ไทย
const AT_START_MIDNIGHT = new Date('2026-11-01T00:00:00+07:00');
const AT_NEXT_DAY_MIDNIGHT = new Date('2026-11-18T00:00:00+07:00');

type Range = { gte: Date; lte?: Date; lt?: Date };
const contains = (r: Range, at: Date) => at >= r.gte && (r.lte ? at <= r.lte : at < r.lt!);
const svcWith = (prisma: unknown) =>
  new ReportsService(prisma as PrismaService, {} as AccountingService);

describe('getRevenuePLReport — ขอบวันตามเวลาไทย', () => {
  function make() {
    const findMany = jest.fn().mockResolvedValue([]);
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _sum: { lateFee: null, amountPaid: null }, _count: 0 });
    const count = jest.fn().mockResolvedValue(0);
    const svc = svcWith({ payment: { findMany, aggregate }, contract: { count } });
    return { svc, findMany, aggregate, count };
  }

  it('ส่ง paidDate / createdAt เป็น [00:00 วันเริ่ม, 23:59:59.999 วันสิ้นสุด] ทั้งสี่ query', async () => {
    const { svc, findMany, aggregate, count } = make();

    await svc.getRevenuePLReport('2026-11-01', '2026-11-17');

    expect(findMany.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
    expect(aggregate.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
    expect(aggregate.mock.calls[1][0].where.paidDate).toEqual({ gte: START, lte: END });
    expect(count.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
  });

  it('ขอบ: แถวเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    const { svc, count } = make();
    await svc.getRevenuePLReport('2026-11-01', '2026-11-17');
    const range = count.mock.calls[0][0].where.createdAt as Range;
    expect(contains(range, AT_START_MIDNIGHT)).toBe(true);
    expect(contains(range, AT_NEXT_DAY_MIDNIGHT)).toBe(false);
  });
});

describe('getSalesComparisonReport — ขอบวันตามเวลาไทย', () => {
  it('ส่ง createdAt เป็น [00:00 วันเริ่ม, 23:59:59.999 วันสิ้นสุด]', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = svcWith({ contract: { findMany } });

    await svc.getSalesComparisonReport('2026-11-01', '2026-11-17');

    const range = findMany.mock.calls[0][0].where.createdAt as Range;
    expect(range).toEqual({ gte: START, lte: END });
    expect(contains(range, AT_START_MIDNIGHT)).toBe(true);
    expect(contains(range, AT_NEXT_DAY_MIDNIGHT)).toBe(false);
  });
});

describe('getDailyPaymentSummary — หนึ่งวันตามปฏิทินไทย', () => {
  const DAY_START = new Date('2026-11-17T17:00:00.000Z'); // 2026-11-18 00:00 น. ไทย
  const DAY_END = new Date('2026-11-18T17:00:00.000Z'); // 2026-11-19 00:00 น. ไทย

  it('ส่ง paidDate = [00:00 วันที่เลือก, 00:00 วันถัดไป) ให้ findMany / count / aggregate', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const aggregate = jest.fn().mockResolvedValue({ _sum: { amountPaid: null } });
    const svc = svcWith({ payment: { findMany, count, aggregate } });

    await svc.getDailyPaymentSummary('2026-11-18');

    for (const call of [findMany, count, aggregate]) {
      expect(call.mock.calls[0][0].where.paidDate).toEqual({ gte: DAY_START, lt: DAY_END });
    }
    const range = findMany.mock.calls[0][0].where.paidDate as Range;
    // เดิม (07:00→07:00): ใบ 02:00 น. ของวันที่ 18 ตกเป็นของวันที่ 17 · ใบ 02:00 น. ของวันที่ 19 นับเป็นของวันที่ 18
    expect(contains(range, new Date('2026-11-18T02:00:00+07:00'))).toBe(true);
    expect(contains(range, new Date('2026-11-19T02:00:00+07:00'))).toBe(false);
  });
});

describe('getEntityProfitReport — ขอบวันตามเวลาไทย', () => {
  it('ส่ง createdAt ของรายการระหว่างบริษัท และ paidDate ของค่าปรับ เป็นช่วงเวลาไทย', async () => {
    const txFindMany = jest.fn().mockResolvedValue([]);
    const aggregate = jest.fn().mockResolvedValue({ _sum: { lateFee: null } });
    const svc = svcWith({
      interCompanyTransaction: { findMany: txFindMany },
      payment: { aggregate },
    });

    await svc.getEntityProfitReport('2026-11-01', '2026-11-17');

    expect(txFindMany.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    expect(aggregate.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
    const range = txFindMany.mock.calls[0][0].where.createdAt as Range;
    expect(contains(range, AT_START_MIDNIGHT)).toBe(true);
    expect(contains(range, AT_NEXT_DAY_MIDNIGHT)).toBe(false);
  });

  it('ยอดค่าปรับยังเป็น Prisma.Decimal → number เหมือนเดิม (ไม่กระทบรูปคำตอบ)', async () => {
    const svc = svcWith({
      interCompanyTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { lateFee: new Prisma.Decimal('150.50') } }),
      },
    });
    const res = (await svc.getEntityProfitReport('2026-11-01', '2026-11-17')) as {
      finance: { lateFeeIncome: number };
    };
    expect(res.finance.lateFeeIncome).toBe(150.5);
  });
});
