import { ReceiptQueryService } from './receipt-query.service';

/**
 * ReceiptQueryService.findAll — dateFrom/dateTo แบบ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม dateFrom = 07:00 น. ⇒ ใบเสร็จ 00:00–06:59 น. ของวันเริ่ม (เช่นเงินจากเกตเวย์) หายจากทั้งตารางและยอดรวม
 * รูปแบบ mock ตาม receipt-query.service.findall-cn.spec.ts
 */
describe('ReceiptQueryService.findAll — ขอบวันตามเวลาไทย', () => {
  let service: ReceiptQueryService;
  let prisma: {
    receipt: { findMany: jest.Mock; count: jest.Mock; aggregate: jest.Mock };
    notificationLog: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      receipt: {
        findMany: jest.fn().mockResolvedValue([{ id: 'r1', cnSource: null, receiptType: 'PAYMENT' }]),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 }, _count: 0 }),
      },
      notificationLog: { findMany: jest.fn() },
    };
    service = new ReceiptQueryService(prisma as never);
  });

  const START = new Date('2026-10-31T17:00:00.000Z'); // 2026-11-01 00:00 น. ไทย
  const END = new Date('2026-11-17T16:59:59.999Z'); // 2026-11-17 23:59:59.999 น. ไทย

  it('paidDate = [00:00 dateFrom, 23:59:59.999 dateTo] ใน findMany / count / aggregate (ยอดรวมใช้ where เดียวกัน)', async () => {
    await service.findAll({ dateFrom: '2026-11-01', dateTo: '2026-11-17' });

    for (const call of [prisma.receipt.findMany, prisma.receipt.count, prisma.receipt.aggregate]) {
      expect(call.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
    }
  });

  it('ขอบ: ใบเที่ยงคืนไทยของ dateFrom อยู่ในช่วง · ใบเที่ยงคืนไทยของวันถัดจาก dateTo อยู่นอกช่วง', async () => {
    await service.findAll({ dateFrom: '2026-11-01', dateTo: '2026-11-17' });
    const { gte, lte } = prisma.receipt.findMany.mock.calls[0][0].where.paidDate as { gte: Date; lte: Date };
    const atFromMidnight = new Date('2026-11-01T00:00:00+07:00');
    const atNextDayMidnight = new Date('2026-11-18T00:00:00+07:00');
    expect(atFromMidnight >= gte && atFromMidnight <= lte).toBe(true);
    expect(atNextDayMidnight <= lte).toBe(false);
  });

  it('ส่งแค่ dateFrom → ไม่มีขอบบน', async () => {
    await service.findAll({ dateFrom: '2026-11-01' });
    expect(prisma.receipt.findMany.mock.calls[0][0].where.paidDate).toEqual({ gte: START });
  });
});
