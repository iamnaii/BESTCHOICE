import {
  ALLOW_WIPE_REAL_STOCK_ENV,
  assertNoRealStock,
  countRealStock,
  RealStockPresentError,
} from './real-stock-guard';
import { realProductWhere } from '../../utils/test-data-markers';

describe('real-stock-guard — ด่าน 5 ของ factory reset (spec 2026-09-05 §6)', () => {
  it('ไม่มีของจริง → ผ่านเงียบ', () => {
    expect(() => assertNoRealStock({ realProducts: 0, realGoodsReceivings: 0 }, {})).not.toThrow();
  });

  it('มีสินค้าจริง → โยนพร้อมตัวเลขและชื่อ env ที่ต้องตั้ง', () => {
    expect(() => assertNoRealStock({ realProducts: 604, realGoodsReceivings: 0 }, {})).toThrow(
      RealStockPresentError,
    );
    try {
      assertNoRealStock({ realProducts: 604, realGoodsReceivings: 2 }, {});
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('604');
      expect(msg).toContain('2');
      expect(msg).toContain('cleanup:test-pack');
      expect(msg).toContain(`${ALLOW_WIPE_REAL_STOCK_ENV}=YES_I_AM_SURE`);
    }
  });

  it('มีใบรับของจริงอย่างเดียวก็บล็อก', () => {
    expect(() => assertNoRealStock({ realProducts: 0, realGoodsReceivings: 1 }, {})).toThrow(
      RealStockPresentError,
    );
  });

  it('ตั้ง ALLOW_WIPE_REAL_STOCK=YES_I_AM_SURE → ผ่าน', () => {
    expect(() =>
      assertNoRealStock(
        { realProducts: 604, realGoodsReceivings: 2 },
        { [ALLOW_WIPE_REAL_STOCK_ENV]: 'YES_I_AM_SURE' },
      ),
    ).not.toThrow();
  });

  it('ค่าอื่นของ env ไม่นับ', () => {
    expect(() =>
      assertNoRealStock(
        { realProducts: 1, realGoodsReceivings: 0 },
        { [ALLOW_WIPE_REAL_STOCK_ENV]: 'yes' },
      ),
    ).toThrow(RealStockPresentError);
  });

  it('countRealStock นับเฉพาะแถว live ที่ไม่มี marker', async () => {
    const prisma = {
      product: { count: jest.fn().mockResolvedValue(7) },
      goodsReceiving: { count: jest.fn().mockResolvedValue(3) },
    };
    await expect(countRealStock(prisma as never)).resolves.toEqual({
      realProducts: 7,
      realGoodsReceivings: 3,
    });
    expect(prisma.product.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null, AND: [realProductWhere] }),
      }),
    );
    expect(prisma.goodsReceiving.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          po: { NOT: { poNumber: { startsWith: 'TEST-' } } },
        }),
      }),
    );
  });
});
