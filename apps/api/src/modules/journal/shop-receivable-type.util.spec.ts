import { classifyShopReceivable } from './shop-receivable-type.util';

describe('classifyShopReceivable (spec 2026-08-19 §2)', () => {
  it('explicit stamp ชนะเสมอ', () => {
    expect(classifyShopReceivable({ shopReceivableType: 'SWAP_CREDIT' })).toBe('SWAP_CREDIT');
    expect(classifyShopReceivable({ shopReceivableType: 'PAYOUT_RECALL' })).toBe('PAYOUT_RECALL');
    expect(classifyShopReceivable({ shopReceivableType: 'SHOP_COLLECT' })).toBe('SHOP_COLLECT');
    // explicit ชนะ legacy fallback ที่ขัดกัน
    expect(
      classifyShopReceivable({ shopReceivableType: 'SWAP_CREDIT', collectedByShop: true }),
    ).toBe('SWAP_CREDIT');
  });

  it('แถวเก่า: map จาก metadata.flow (forward-only ไม่ backfill)', () => {
    expect(classifyShopReceivable({ flow: 'exchange-buyback-receivable-11-2107' })).toBe(
      'SWAP_CREDIT',
    );
    expect(classifyShopReceivable({ flow: 'shop-exchange-return' })).toBe('SWAP_CREDIT');
    expect(classifyShopReceivable({ flow: 'shop-collect-settlement' })).toBe('SHOP_COLLECT');
  });

  it('แถวเก่า JP4 shop-collect: จาก collectedByShop / shopReceivable', () => {
    expect(classifyShopReceivable({ collectedByShop: true })).toBe('SHOP_COLLECT');
    expect(classifyShopReceivable({ shopReceivable: '11-2107' })).toBe('SHOP_COLLECT');
  });

  it('ไม่รู้จัก = UNKNOWN (ห้ามเดา)', () => {
    expect(classifyShopReceivable({ flow: 'payment-receipt-2b' })).toBe('UNKNOWN');
    expect(classifyShopReceivable({})).toBe('UNKNOWN');
    expect(classifyShopReceivable(null)).toBe('UNKNOWN');
    expect(classifyShopReceivable('string')).toBe('UNKNOWN');
    expect(classifyShopReceivable({ shopReceivableType: 'INVALID' })).toBe('UNKNOWN');
  });
});
