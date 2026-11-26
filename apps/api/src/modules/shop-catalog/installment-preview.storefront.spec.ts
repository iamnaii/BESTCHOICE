import { ShopCatalogController } from './shop-catalog.controller';
import { toStorefrontPreview, type PreviewResult } from './installment-preview.service';

const gfin: PreviewResult = {
  available: true,
  provider: 'GFIN',
  monthlyPayment: 1234,
  downAmount: 3000,
  totalWithVat: 20000,
  financedAmount: 17000,
  months: 10,
  allowedMonths: [6, 8, 10],
  defaultMonths: 10,
};

const bc: PreviewResult = {
  available: true,
  provider: 'BC',
  monthlyPayment: 900,
  downAmount: 2300,
  totalWithVat: 15000,
  financedAmount: 12700,
  months: 12,
  minDownPct: 15,
  allowedMonths: [6, 12],
};

describe('storefront installment-preview (A1)', () => {
  it('GFIN: ไม่ส่ง financedAmount / totalWithVat · ที่เหลือครบ', () => {
    const out = toStorefrontPreview(gfin);
    expect(out).not.toHaveProperty('financedAmount');
    expect(out).not.toHaveProperty('totalWithVat');
    expect(out).toMatchObject({
      available: true,
      provider: 'GFIN',
      monthlyPayment: 1234,
      downAmount: 3000,
      months: 10,
      allowedMonths: [6, 8, 10],
      defaultMonths: 10,
    });
    // ไม่แก้ผลของ service (บอทขายอ่านตัวเดิม)
    expect(gfin.financedAmount).toBe(17000);
    expect(gfin.totalWithVat).toBe(20000);
  });

  it('BC: เหมือนเดิมทุกฟิลด์', () => {
    expect(toStorefrontPreview(bc)).toEqual(bc);
  });

  it('ไม่พร้อม (available:false) คงเดิม', () => {
    const fail: PreviewResult = { available: false, reason: 'invalid', errors: ['x'] };
    expect(toStorefrontPreview(fail)).toEqual(fail);
  });

  it('controller คืนผลที่ตัดแล้ว ส่วน service คืนเต็มเหมือนเดิม', async () => {
    const preview = jest.fn().mockResolvedValue(gfin);
    const ctrl = new ShopCatalogController({} as never, { preview } as never);
    const out = await ctrl.getInstallmentPreview({ productId: 'p1' } as never);
    expect(out).not.toHaveProperty('financedAmount');
    expect(out).not.toHaveProperty('totalWithVat');
    expect(await preview.mock.results[0].value).toHaveProperty('financedAmount', 17000);
  });
});
