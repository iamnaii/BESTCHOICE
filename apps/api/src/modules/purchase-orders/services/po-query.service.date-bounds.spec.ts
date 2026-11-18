import { PoQueryService } from './po-query.service';

/**
 * ประวัติรับของ/สรุปรับของของใบสั่งซื้อ — startDate/endDate 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * รูปแบบ mock ตาม purchase-orders.summary.spec.ts (prisma ปั้นมือ)
 */
const START = new Date('2026-10-31T17:00:00.000Z');
const END = new Date('2026-11-17T16:59:59.999Z');

function make() {
  const prisma = {
    purchaseOrder: {
      findUnique: jest.fn().mockResolvedValue({ id: 'po-1', deletedAt: null, status: 'ORDERED', items: [] }),
    },
    goodsReceiving: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    goodsReceivingItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new PoQueryService(prisma as never) };
}

describe('PoQueryService.getGoodsReceivings — ขอบวันตามเวลาไทย', () => {
  it('createdAt = [00:00 startDate, 23:59:59.999 endDate]', async () => {
    const { prisma, service } = make();

    await service.getGoodsReceivings('po-1', { startDate: '2026-11-01', endDate: '2026-11-17' });

    const where = prisma.goodsReceiving.findMany.mock.calls[0][0].where;
    expect(where.createdAt).toEqual({ gte: START, lte: END });
    expect(prisma.goodsReceiving.count.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    // ขอบ: เที่ยงคืนไทยของวันเริ่มอยู่ใน · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอก
    expect(new Date('2026-11-01T00:00:00+07:00') >= where.createdAt.gte).toBe(true);
    expect(new Date('2026-11-18T00:00:00+07:00') <= where.createdAt.lte).toBe(false);
  });
});

describe('PoQueryService.getReceivingSummary — ขอบวันตามเวลาไทย', () => {
  it('receiving.createdAt = [00:00 startDate, 23:59:59.999 endDate]', async () => {
    const { prisma, service } = make();

    await service.getReceivingSummary('po-1', { startDate: '2026-11-01', endDate: '2026-11-17' });

    const where = prisma.goodsReceivingItem.findMany.mock.calls[0][0].where;
    expect(where.receiving.createdAt).toEqual({ gte: START, lte: END });
  });

  it('ไม่ส่งวันที่ → ไม่มีตัวกรอง createdAt', async () => {
    const { prisma, service } = make();
    await service.getReceivingSummary('po-1', {});
    expect(prisma.goodsReceivingItem.findMany.mock.calls[0][0].where.receiving.createdAt).toBeUndefined();
  });
});
