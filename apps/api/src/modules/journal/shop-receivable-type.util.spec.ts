import { SHOP_RECEIVABLE_TYPES, classifyShopReceivable } from './shop-receivable-type.util';

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

  it('DEVICE_RETURN (ใบรับเครื่องคืน 2026-09-20 §6.2): explicit stamp เท่านั้น — ไม่มี flow fallback', () => {
    expect(classifyShopReceivable({ shopReceivableType: 'DEVICE_RETURN' })).toBe('DEVICE_RETURN');
    // explicit ชนะ marker เก่าของ JP5 (shopReceivable: '11-2107' เคยแปลว่า SHOP_COLLECT)
    expect(
      classifyShopReceivable({ shopReceivableType: 'DEVICE_RETURN', shopReceivable: '11-2107' }),
    ).toBe('DEVICE_RETURN');
    // แถวยึดเก่า flow shop-repossession-intake ที่ไม่มี stamp = โหมดโอนทันที (ไม่แตะ S21-1104)
    // ถ้าใส่ flow fallback จะถูกจัดเป็น DEVICE_RETURN โดยไม่มีหนี้จริง — ต้องเป็น UNKNOWN
    expect(classifyShopReceivable({ flow: 'shop-repossession-intake' })).toBe('UNKNOWN');
  });

  it('SHOP_RECEIVABLE_TYPES เป็นแหล่งเดียวของ EXPLICIT — ทุกค่าในลิสต์ classify เป็นตัวเอง', () => {
    expect([...SHOP_RECEIVABLE_TYPES]).toEqual([
      'SWAP_CREDIT',
      'PAYOUT_RECALL',
      'SHOP_COLLECT',
      'DEVICE_RETURN',
    ]);
    for (const type of SHOP_RECEIVABLE_TYPES) {
      expect(classifyShopReceivable({ shopReceivableType: type })).toBe(type);
    }
  });
});
