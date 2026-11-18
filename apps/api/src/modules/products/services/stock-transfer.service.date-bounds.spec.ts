import { StockTransferService } from './stock-transfer.service';

/**
 * StockTransferService.getTransferHistory — startDate/endDate 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * ปั้น prisma ด้วยมือ (โมดูลนี้ไม่มี spec ของ service นี้)
 */
describe('StockTransferService.getTransferHistory — ขอบวันตามเวลาไทย', () => {
  const START = new Date('2026-10-31T17:00:00.000Z'); // 2026-11-01 00:00 น. ไทย
  const END = new Date('2026-11-17T16:59:59.999Z'); // 2026-11-17 23:59:59.999 น. ไทย

  function make() {
    const prisma = {
      stockTransfer: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    return { prisma, service: new StockTransferService(prisma as never) };
  }

  it('createdAt = [00:00 startDate, 23:59:59.999 endDate] ทั้ง findMany และ count', async () => {
    const { prisma, service } = make();

    await service.getTransferHistory({ startDate: '2026-11-01', endDate: '2026-11-17' });

    expect(prisma.stockTransfer.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    expect(prisma.stockTransfer.count.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    const { gte, lte } = prisma.stockTransfer.findMany.mock.calls[0][0].where.createdAt;
    expect(new Date('2026-11-01T00:00:00+07:00') >= gte).toBe(true);
    expect(new Date('2026-11-18T00:00:00+07:00') <= lte).toBe(false);
  });

  it('ไม่ส่งวันที่ → ไม่มีตัวกรอง createdAt', async () => {
    const { prisma, service } = make();
    await service.getTransferHistory({});
    expect(prisma.stockTransfer.findMany.mock.calls[0][0].where.createdAt).toBeUndefined();
  });
});
