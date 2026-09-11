import { describe, expect, it } from 'vitest';
import { buildStickerView, formatWarrantyShort, type StickerProductData } from './stickerView';

function product(overrides: Partial<StickerProductData> = {}): StickerProductData {
  return {
    productId: 'p1',
    name: 'Apple iPhone 15 128GB Black',
    brand: 'Apple',
    model: 'iPhone 15',
    category: 'PHONE_NEW',
    status: 'IN_STOCK',
    color: 'ดำ',
    storage: '128GB',
    batteryHealth: null,
    hasBox: true,
    warrantyExpireDate: '2027-08-27',
    imei: '351000000007919',
    stockInDate: '2026-08-11T03:00:00.000Z',
    cashPrice: '19900',
    installmentPrice: '19900',
    prices: [{ label: 'ราคาเงินสด', amount: '19900', isDefault: true }],
    ...overrides,
  };
}

const quotes = {
  rate1: { months: 12, downAmount: 2985, monthlyPayment: 1840.07 },
  rate2: { months: 12, downAmount: 1900, monthlyPayment: 3327 },
};

describe('formatWarrantyShort', () => {
  it('YYYY-MM-DD → DD/MM/YY (ปี ค.ศ. 2 หลัก ให้พอดีความกว้างดวง)', () => {
    expect(formatWarrantyShort('2027-08-27')).toBe('27/08/27');
  });
  it('รูปแบบไม่ถูกต้อง → null', () => {
    expect(formatWarrantyShort('27/08/2027')).toBeNull();
    expect(formatWarrantyShort('')).toBeNull();
  });
});

describe('buildStickerView — มือ 1', () => {
  it('รุ่นอย่างเดียว (ไม่มียี่ห้อ) + สเปก + ประกันศูนย์ + ราคาเครื่อง + 2 เรท + IMEI', () => {
    const view = buildStickerView(product(), quotes);
    expect(view).toEqual({
      productId: 'p1',
      model: 'iPhone 15',
      spec: 'ดำ · 128GB',
      warrantyLabel: 'ประกันศูนย์ 27/08/27',
      used: null,
      cash: '19,900',
      rates: [
        { no: 1, down: '2,985', monthly: '1,840.07', months: 12 },
        { no: 2, down: '1,900', monthly: '3,327', months: 12 },
      ],
      imei: '351000000007919',
    });
  });

  it('ไม่มีประกันศูนย์ = ไม่มีป้าย · รุ่นที่ไม่มีในตาราง GFIN = เรท 1 อย่างเดียว', () => {
    const view = buildStickerView(product({ warrantyExpireDate: null }), { ...quotes, rate2: null });
    expect(view?.warrantyLabel).toBeNull();
    expect(view?.rates).toEqual([{ no: 1, down: '2,985', monthly: '1,840.07', months: 12 }]);
  });

  it('ยังไม่ตั้งราคาเงินสด (คอลัมน์และแถวราคาว่าง) → null = ไม่พิมพ์ ไม่มี ฿0 อีก', () => {
    expect(buildStickerView(product({ cashPrice: null, prices: [] }), quotes)).toBeNull();
    expect(buildStickerView(product({ cashPrice: '0', prices: [] }), quotes)).toBeNull();
  });

  it('ราคาเงินสดอ่านทางเดียวกับหน้าสินค้า: คอลัมน์ว่างแต่มีแถว "ราคาเงินสด" → ใช้แถวนั้น', () => {
    const view = buildStickerView(
      product({ cashPrice: null, prices: [{ label: 'ราคาเงินสด', amount: '18900', isDefault: true }] }),
      { rate1: null, rate2: null },
    );
    expect(view?.cash).toBe('18,900');
    expect(view?.rates).toEqual([]);
  });

  it('อุปกรณ์ที่ไม่มีรุ่นใช้ชื่อสินค้าแทน · ไม่มีสี/ความจุ = ไม่มีบรรทัดสเปก', () => {
    const view = buildStickerView(
      product({ category: 'ACCESSORY', model: '', name: 'เคสใส iPhone 16', color: null, storage: null, imei: null }),
      { rate1: null, rate2: null },
    );
    expect(view?.model).toBe('เคสใส iPhone 16');
    expect(view?.spec).toBeNull();
    expect(view?.imei).toBeNull();
  });
});

describe('buildStickerView — มือสอง', () => {
  it('มีชิป %แบต + มีกล่อง/ไม่มีกล่อง เฉพาะมือสอง', () => {
    const view = buildStickerView(
      product({ category: 'PHONE_USED', batteryHealth: 91, hasBox: false, warrantyExpireDate: '2027-03-12' }),
      quotes,
    );
    expect(view?.used).toEqual({ battery: 91, box: false });
    expect(view?.warrantyLabel).toBe('ประกันศูนย์ 12/03/27');
  });

  it('แบตนอกช่วง 0–100 หรือไม่ระบุ = ไม่มีชิปแบต · กล่องไม่ระบุ = ไม่มีชิปกล่อง', () => {
    const view = buildStickerView(product({ category: 'PHONE_USED', batteryHealth: 140, hasBox: null }), quotes);
    expect(view?.used).toEqual({ battery: null, box: null });
  });
});
