import { shopWarrantyDatesFor } from './sale-shop-warranty.util';

const tx = (configValue: string | null) =>
  ({
    systemConfig: {
      findUnique: jest
        .fn()
        .mockResolvedValue(configValue === null ? null : { value: configValue }),
      findFirst: jest
        .fn()
        .mockResolvedValue(configValue === null ? null : { value: configValue }),
    },
  }) as never;
const soldAt = new Date('2026-10-12T05:00:00.000Z');

describe('shopWarrantyDatesFor (PR 5 T8 — ตัวเดียวสำหรับ POS และส่งมอบเครื่องทดแทน)', () => {
  it('มือสองไม่มีค่าเฉพาะเครื่อง + ไม่มี config → 60 วัน · start = soldAt', async () => {
    const r = await shopWarrantyDatesFor(
      tx(null),
      { category: 'PHONE_USED', shopWarrantyDays: null },
      soldAt,
    );
    expect(r.days).toBe(60);
    expect(r.shopWarrantyStartDate).toEqual(soldAt);
    expect(r.shopWarrantyEndDate).toEqual(new Date('2026-12-11T05:00:00.000Z'));
  });

  it('เครื่องใหม่ (ไม่มีนโยบายประกันร้าน) → days null · end null · start ยังตั้ง (ฐานกรอบ 7 วัน)', async () => {
    const r = await shopWarrantyDatesFor(
      tx(null),
      { category: 'PHONE_NEW', shopWarrantyDays: null },
      soldAt,
    );
    expect(r.days).toBeNull();
    expect(r.shopWarrantyEndDate).toBeNull();
    expect(r.shopWarrantyStartDate).toEqual(soldAt);
  });

  it('ค่าเฉพาะเครื่อง 0 = ไม่มีประกัน → end null', async () => {
    const r = await shopWarrantyDatesFor(
      tx('90'),
      { category: 'PHONE_USED', shopWarrantyDays: 0 },
      soldAt,
    );
    expect(r.days).toBeNull();
    expect(r.shopWarrantyEndDate).toBeNull();
  });
});
