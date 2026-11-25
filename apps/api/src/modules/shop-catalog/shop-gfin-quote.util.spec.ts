import Decimal from 'decimal.js';
import { GFIN_SETTINGS_DEFAULTS, type GfinSettings } from '../gfin-config/gfin-settings.util';
import {
  computeShopGfinQuote,
  pickDefaultMonths,
  resolveShopGfinPlan,
  toGfinFactorRow,
  toGfinMappingRows,
  toGfinRuleRows,
  type ShopGfinProduct,
} from './shop-gfin-quote.util';

// ตัวอย่างเดียวกับ installment-preview.service.spec.ts "GFIN: returns canonical worked example"
const SETTINGS: GfinSettings = { ...GFIN_SETTINGS_DEFAULTS, minDownPct: 30 };
const PRODUCT: ShopGfinProduct = {
  brand: 'Apple',
  model: 'iPhone 14 Pro',
  storage: '128GB',
  category: 'PHONE_USED',
  deviceOrigin: 'THAI',
};
const MAPPINGS = toGfinMappingRows([
  {
    id: 'm1',
    gfinSeries: 'iPhone 14',
    gfinVariant: 'Pro',
    storage: '128GB',
    condition: 'HAND_2',
    maxPrice: '21500',
    modelMatchPattern: 'iPhone 14 Pro',
    isActive: true,
  },
]);
const rules = (over: Record<string, unknown> = {}) =>
  toGfinRuleRows([
    {
      id: 'r1',
      label: 'iPhone 14 มือ 2',
      seriesPattern: 'iPhone 14|iPhone 15',
      condition: 'HAND_2',
      allowance: '1000',
      isActive: true,
      ...over,
    },
  ]);
const FACTOR_12 = toGfinFactorRow({
  months: 12,
  shopCommissionPct: 15,
  factor: '0.179238',
  feePerInstallment: '100',
  isActive: true,
});

function plan(over: Partial<Parameters<typeof resolveShopGfinPlan>[0]> = {}) {
  return resolveShopGfinPlan({
    product: PRODUCT,
    settings: SETTINGS,
    mappings: MAPPINGS,
    rules: rules(),
    factorMonths: [12],
    templateMonths: null,
    ...over,
  });
}

describe('pickDefaultMonths', () => {
  it('ตรงในรายการ → ใช้เลย · ไม่ตรง → งวดมากสุดที่ไม่เกิน · ต่ำกว่าทุกตัว → งวดแรก', () => {
    expect(pickDefaultMonths(12, [10, 12, 15])).toBe(12);
    expect(pickDefaultMonths(15, [10, 12])).toBe(12);
    expect(pickDefaultMonths(6, [10, 12])).toBe(10);
    expect(pickDefaultMonths(12, [])).toBe(12);
  });
});

describe('resolveShopGfinPlan', () => {
  it('ไม่มีราคากลางของรุ่น → no_gfin_mapping', () => {
    const r = plan({ product: { ...PRODUCT, model: 'iPhone 8' } });
    expect(r).toEqual({ ok: false, reason: 'no_gfin_mapping' });
  });

  it('มีราคากลางแต่ไม่มีเงื่อนไขของรุ่น → no_gfin_rule', () => {
    expect(plan({ rules: [] })).toEqual({ ok: false, reason: 'no_gfin_rule' });
  });

  it('งวดตั้งต้น = งวดของราคากลาง ถ้าไม่มีใช้เพดานของรุ่น · ดาวน์ขั้นต่ำจากค่าตั้ง', () => {
    const r = plan({ factorMonths: [10, 12, 15], templateMonths: 15, rules: rules({ maxMonths: 12 }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.allowedMonths).toEqual([10, 12]);
    expect(r.defaultMonths).toBe(12);
    expect(r.months).toBe(12);
    expect(r.commissionPct).toBe(15);
    expect(r.minDownPct.toString()).toBe('0.3');
  });

  it('ขอเกินเพดานงวดของรุ่น → months_over_max พร้อมงวดที่เลือกได้', () => {
    const r = plan({ factorMonths: [10, 12, 15], rules: rules({ maxMonths: 12 }), requestedMonths: 15 });
    expect(r).toEqual({ ok: false, reason: 'months_over_max', allowedMonths: [10, 12], defaultMonths: 12 });
  });

  it('เงื่อนไขของรุ่นตั้งดาวน์ขั้นต่ำเอง → ใช้ค่านั้นแทนค่าตั้ง', () => {
    const r = plan({ rules: rules({ minDownPct: 25 }) });
    expect(r.ok && r.minDownPct.toString()).toBe('0.25');
  });
});

describe('computeShopGfinQuote', () => {
  const quote = (salePrice: string, over: Record<string, unknown> = {}) => {
    const p = plan();
    if (!p.ok) throw new Error('plan failed');
    return computeShopGfinQuote(p, {
      product: PRODUCT,
      salePrice: new Decimal(salePrice),
      settings: SETTINGS,
      factor: FACTOR_12,
      ...over,
    });
  };

  it('ตัวอย่างหลัก: ราคา 19,900 → ดาวน์ 4,200 ผ่อน 2,923 × 12', () => {
    // ราคาส่ง 22,500 · ดาวน์ตามสูตร 6,750 − ส่วนต่าง 2,600 = 4,150 → ปัดขึ้นหลักร้อย 4,200
    expect(quote('19900')).toEqual({
      ok: true,
      monthlyPayment: 2923,
      downAmount: 4200,
      financedAmount: 15750,
      months: 12,
    });
  });

  it('ส่วนต่างราคาครอบดาวน์ทั้งก้อน → ดาวน์ 0 (ฟรีดาวน์) ค่างวดเท่าเดิม', () => {
    // ราคา 15,000 → ส่วนต่าง 7,500 ≥ ดาวน์ตามสูตร 6,750
    expect(quote('15000')).toMatchObject({ ok: true, downAmount: 0, monthlyPayment: 2923, months: 12 });
  });

  it('ไม่ส่ง % ดาวน์ = ดาวน์ขั้นต่ำ · ส่งต่ำกว่าขั้นต่ำ = ยกขึ้นเป็นขั้นต่ำ', () => {
    expect(quote('19900', { downPct: new Decimal('0.10') })).toEqual(quote('19900'));
  });

  it('ส่ง % ดาวน์สูงกว่าขั้นต่ำ → ดาวน์เพิ่ม ยอดจัดลด', () => {
    const r = quote('19900', { downPct: new Decimal('0.50') });
    // ดาวน์ตามสูตร 11,250 − 2,600 = 8,650 → 8,700 · ยอดจัด 11,250
    expect(r).toMatchObject({ ok: true, downAmount: 8700, financedAmount: 11250 });
  });

  it('ไม่มีเรทของงวดนั้น → no_rate_factor', () => {
    expect(quote('19900', { factor: null })).toEqual({ ok: false, reason: 'no_rate_factor' });
  });

  it('เรทไม่ตรงงวดของแผน → invalid พร้อมข้อความ', () => {
    const r = quote('19900', { factor: { ...FACTOR_12, months: 10 } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('invalid');
    expect(!r.ok && r.errors?.length).toBeGreaterThan(0);
  });
});
