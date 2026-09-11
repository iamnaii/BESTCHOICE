import { describe, it, expect } from 'vitest';
import {
  buildGfinQuote,
  defaultCommissionPct,
  gfinCategoryOf,
  type GfinTables,
} from './gfinQuote';
import { pickDefaultMonths } from './monthsOptions';

// ตารางราคา GFIN 15 ส.ค. 2569: iPhone 15 128GB มือ 1 = 23,000 · OVER 1,000 · ผ่อนสูงสุด 12
const tables: GfinTables = {
  mappings: [
    {
      id: 'm15',
      gfinSeries: 'iPhone 15',
      gfinVariant: null,
      storage: '128GB',
      condition: 'HAND_1',
      maxPrice: '23000',
      modelMatchPattern: 'iPhone 15',
      isActive: true,
    },
  ],
  rules: [
    {
      id: 'r15',
      label: 'iPhone 15 มือ 1',
      seriesPattern: 'iPhone 15',
      condition: 'HAND_1',
      allowance: '1000',
      maxMonths: 12,
      isActive: true,
    },
  ],
  factors: [
    { id: 'f10', months: 10, shopCommissionPct: 15, factor: '0.200952', feePerInstallment: '100', isActive: true },
    { id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.179238', feePerInstallment: '100', isActive: true },
    { id: 'f15', months: 15, shopCommissionPct: 15, factor: '0.1467', feePerInstallment: '100', isActive: true },
    { id: 'f12c5', months: 12, shopCommissionPct: 5, factor: '0.16', feePerInstallment: '100', isActive: true },
    { id: 'f8off', months: 8, shopCommissionPct: 15, factor: '0.23', feePerInstallment: '100', isActive: false },
  ],
  settings: {
    minDownPct: 25,
    maxDownPct: 80,
    downStepPct: 5,
    contractFee: 100,
    commissionPctByCategory: { PHONE: 15, TABLET: 5 },
  },
};
const iphone15 = { brand: 'Apple', model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW' };

describe('buildGfinQuote', () => {
  it('12 งวด ดาวน์ 25% คอม 15 → 3,327/เดือน ลูกค้าดาวน์จริง 1,900 · ตัวเลือกงวด [10, 12] (15 ถูกตัดโดยผ่อนสูงสุด 12, 8 ปิดใช้งาน)', () => {
    const q = buildGfinQuote(tables, {
      product: iphone15,
      installmentPrice: 19900,
      months: 12,
      downPct: 25,
      commissionPct: 15,
    });
    expect(q.available).toBe(true);
    if (!q.available) return;
    expect(q.result.gfinSubmitPrice.toNumber()).toBe(24000);
    expect(q.result.downAmountActual.toNumber()).toBe(1900);
    expect(q.result.monthlyPayment.toNumber()).toBe(3327);
    expect(q.result.netTransferToShop.toNumber()).toBe(20600);
    expect(q.maxMonths).toBe(12);
    expect(q.monthsOptions.map((o) => o.months)).toEqual([10, 12]);
    expect(q.monthsOptions[1].monthly).toBe(3327);
    // ceil(18000 × 0.200952 = 3617.14) = 3618 + 100
    expect(q.monthsOptions[0].monthly).toBe(3718);
  });

  it('คอม 5% ใช้เรทคนละชุด: ceil(18000 × 0.16) + 100 = 2,980', () => {
    const q = buildGfinQuote(tables, {
      product: iphone15,
      installmentPrice: 19900,
      months: 12,
      downPct: 25,
      commissionPct: 5,
    });
    expect(q.available).toBe(true);
    if (!q.available) return;
    expect(q.result.monthlyPayment.toNumber()).toBe(2980);
    expect(q.result.shopCommissionAmount.toNumber()).toBe(900);
  });

  it('รุ่นไม่อยู่ในตาราง (Samsung) → no_mapping', () => {
    const q = buildGfinQuote(tables, {
      product: { brand: 'Samsung', model: 'Galaxy S24', storage: '256GB', category: 'PHONE_USED' },
      installmentPrice: 18900,
      months: 12,
      downPct: 25,
      commissionPct: 15,
    });
    expect(q).toMatchObject({ available: false, reason: 'no_mapping', monthsOptions: [] });
  });

  it('งวดที่เลือกไม่มีเรท → no_factor พร้อมตัวเลือกงวดที่มีให้เลือกใหม่', () => {
    const q = buildGfinQuote(tables, {
      product: iphone15,
      installmentPrice: 19900,
      months: 6,
      downPct: 25,
      commissionPct: 15,
    });
    expect(q.available).toBe(false);
    if (q.available) return;
    expect(q.reason).toBe('no_factor');
    expect(q.monthsOptions.map((o) => o.months)).toEqual([10, 12]);
  });

  it('หมวดที่ GFIN ไม่รับ (ACCESSORY) → unsupported_category', () => {
    const q = buildGfinQuote(tables, {
      product: { brand: 'Apple', model: 'AirPods', storage: null, category: 'ACCESSORY' },
      installmentPrice: 5900,
      months: 12,
      downPct: 25,
      commissionPct: 15,
    });
    expect(q).toMatchObject({ available: false, reason: 'unsupported_category' });
  });
});

describe('gfinCategoryOf / defaultCommissionPct / pickDefaultMonths', () => {
  it('แมปหมวดสินค้าเป็นหมวดของ GFIN', () => {
    expect(gfinCategoryOf('PHONE_NEW')).toBe('PHONE_NEW');
    expect(gfinCategoryOf('PHONE_USED')).toBe('PHONE_USED');
    expect(gfinCategoryOf('TABLET')).toBe('TABLET');
    expect(gfinCategoryOf('ACCESSORY')).toBeNull();
  });

  it('คอมตั้งต้น: iPad 5 · มือถือ 15', () => {
    expect(defaultCommissionPct(tables.settings, 'TABLET')).toBe(5);
    expect(defaultCommissionPct(tables.settings, 'PHONE_USED')).toBe(15);
  });

  it('pickDefaultMonths: มี 12 → 12 · ไม่มี → ตัวใหญ่สุดที่ไม่เกิน 12 · ไม่มีเลย → ตัวแรก · ว่าง → null', () => {
    expect(pickDefaultMonths([6, 9, 12, 18])).toBe(12);
    expect(pickDefaultMonths([6, 10, 15])).toBe(10);
    expect(pickDefaultMonths([15, 18])).toBe(15);
    expect(pickDefaultMonths([])).toBeNull();
  });
});
