import { TaxPreviewService } from './tax-preview.service';

/**
 * ภ.ง.ด.1ก (previewPnd1Annual) — ขอบปีต้องเป็นปีปฏิทินไทย (2026-11-18)
 * เดิมใช้ Date.UTC(year,0,1) .. Date.UTC(year,11,31,23,59,59,999) = 07:00 น. ไทย 1 ม.ค. .. 06:59:59.999 น. ไทย 1 ม.ค. ปีถัดไป
 * ⇒ ใบเงินเดือนที่จ่าย (paidAt เป็นเวลาจริง) 00:00–06:59 น. ของ 1 ม.ค. ถูกนับเข้าปีก่อน
 * และที่จ่าย 00:00–06:59 น. ของ 1 ม.ค. ปีถัดไปถูกนับเข้าปีนี้
 * ตามแบบ tax-preview.input-vat.spec.ts (new TaxPreviewService(prisma) + hand-built prisma mock)
 */
describe('TaxPreviewService.previewPnd1Annual — ขอบปีปฏิทินไทย', () => {
  const START = new Date('2025-12-31T17:00:00.000Z'); // 00:00 น. ไทย 1 ม.ค. 2026
  const END = new Date('2026-12-31T16:59:59.999Z'); // 23:59:59.999 น. ไทย 31 ธ.ค. 2026

  function build() {
    const prisma = { expenseDocument: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new TaxPreviewService(prisma as never);
    return { service, prisma };
  }

  it('paidAt และ documentDate ใช้ช่วงเดียวกัน = 1 ม.ค. 00:00 น. ถึง 31 ธ.ค. 23:59:59.999 น. (เวลาไทย)', async () => {
    const { service, prisma } = build();
    await service.previewPnd1Annual(2026);
    const where = prisma.expenseDocument.findMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ paidAt: { gte: START, lte: END } });
    expect(where.OR[1]).toEqual({ paidAt: null, documentDate: { gte: START, lte: END } });
  });

  it('จ่ายเที่ยงคืนไทยของ 1 ม.ค. อยู่ในปีนั้น · จ่าย 23:59:59.999 น. ไทยของ 31 ธ.ค. ปีก่อนอยู่นอก · จ่ายเที่ยงคืนไทยของ 1 ม.ค. ปีถัดไปอยู่นอก', async () => {
    const { service, prisma } = build();
    await service.previewPnd1Annual(2026);
    const { gte, lte } = prisma.expenseDocument.findMany.mock.calls[0][0].where.OR[0].paidAt as {
      gte: Date;
      lte: Date;
    };
    const newYearMidnight = new Date('2026-01-01T00:00:00+07:00');
    const lastMomentOfPreviousYear = new Date('2025-12-31T23:59:59.999+07:00');
    const lastMomentOfYear = new Date('2026-12-31T23:59:59.999+07:00');
    const nextNewYearMidnight = new Date('2027-01-01T00:00:00+07:00');
    expect(newYearMidnight >= gte && newYearMidnight <= lte).toBe(true);
    expect(lastMomentOfYear >= gte && lastMomentOfYear <= lte).toBe(true);
    expect(lastMomentOfPreviousYear >= gte).toBe(false);
    expect(nextNewYearMidnight <= lte).toBe(false);
  });

  it('ใบเงินเดือนที่ลงวันที่จ่าย 07:00 น. ไทย (documentDate แบบ YYYY-MM-DD) ของ 1 ม.ค. และ 31 ธ.ค. ยังอยู่ในปีเดิม', async () => {
    const { service, prisma } = build();
    await service.previewPnd1Annual(2026);
    const { gte, lte } = prisma.expenseDocument.findMany.mock.calls[0][0].where.OR[1].documentDate as {
      gte: Date;
      lte: Date;
    };
    const firstDay = new Date('2026-01-01'); // 07:00 น. ไทย
    const lastDay = new Date('2026-12-31'); // 07:00 น. ไทย
    expect(firstDay >= gte && firstDay <= lte).toBe(true);
    expect(lastDay >= gte && lastDay <= lte).toBe(true);
  });
});
