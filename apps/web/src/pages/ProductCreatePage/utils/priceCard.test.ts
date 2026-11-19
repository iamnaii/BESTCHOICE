import { describe, expect, it } from 'vitest';
import type { BcConfigJson } from '@installment/shared';
import { toModelQuoteGfinContext, type GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';
import {
  accessoryProfit,
  computeCardQuote,
  editedKeys,
  gfinBlocked,
  hasAnyPrice,
  mergeTemplate,
  templateFields,
  templateLabelOf,
  toPricePayload,
  type CardQuoteInput,
  type PriceTemplate,
} from './priceCard';

// ตัวเลขชีต (สเปคข้อ 4.5) — iPhone 15 128GB มือ 1
const bcConfig: BcConfigJson = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 10: 0.5, 12: 0.5 },
  allowedMonths: [10, 12],
};
const gfinTables: GfinTables = {
  mappings: [
    { id: 'm15', gfinSeries: 'iPhone 15', gfinVariant: null, storage: '128GB', condition: 'HAND_1', maxPrice: '24900', modelMatchPattern: 'iPhone 15', isActive: true },
  ],
  rules: [
    { id: 'r15', label: 'iPhone 15 มือ 1', seriesPattern: 'iPhone 15', condition: 'HAND_1', allowance: '1000', maxMonths: 12, isActive: true },
  ],
  factors: [{ id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.17', feePerInstallment: '100', isActive: true }],
  settings: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } },
};
const TEMPLATE: PriceTemplate = {
  cashPrice: '25900.00',
  installmentBestchoicePrice: '25900.00',
  installmentFinancePrice: '25900.00',
  rate1TermMonths: null,
  rate1DownPayment: null,
  rate2TermMonths: null,
};
const INPUT: CardQuoteInput = {
  category: 'PHONE_NEW',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  deviceOrigin: 'THAI',
  fields: { cash: '25900', bc: '25900', finance: '25900' },
  template: TEMPLATE,
  costPrice: '25800',
  bcConfig,
  gfinTables,
};

describe('ช่องราคาของการ์ด', () => {
  it('templateFields: ทศนิยมจาก API → ตัวเลขล้วน · 0 = ว่าง', () => {
    expect(templateFields(TEMPLATE)).toEqual({ cash: '25900', bc: '25900', finance: '25900' });
    expect(templateFields({ ...TEMPLATE, installmentFinancePrice: '0.00' })?.finance).toBe('');
    expect(templateFields(null)).toBeNull();
  });

  it('editedKeys: เทียบเป็นตัวเลข · ราคากลางช่องนั้นว่าง = ไม่นับ', () => {
    const tpl = { cash: '25900', bc: '25900', finance: '' };
    expect(editedKeys({ cash: '25900.00', bc: '27000', finance: '9999' }, tpl)).toEqual(['bc']);
    expect(editedKeys({ cash: '', bc: '25900', finance: '' }, tpl)).toEqual(['cash']);
    expect(editedKeys({ cash: '1', bc: '1', finance: '1' }, null)).toEqual([]);
  });

  it('mergeTemplate: ช่องว่าง/ยังเป็นราคากลางเดิม → ตามชุดใหม่ · ช่องที่แก้เอง → คงไว้ · ไม่พบ → ล้างเฉพาะช่องอัตโนมัติ', () => {
    const prev = { cash: '25900', bc: '25900', finance: '25900' };
    const next = { cash: '29900', bc: '29900', finance: '30500' };
    const current = { cash: '25900', bc: '27000', finance: '' };
    expect(mergeTemplate(current, prev, next)).toEqual({ cash: '29900', bc: '27000', finance: '30500' });
    expect(mergeTemplate(current, prev, null)).toEqual({ cash: '', bc: '27000', finance: '' });
    expect(mergeTemplate({ cash: '', bc: '', finance: '' }, null, next)).toEqual(next);
  });

  it('templateLabelOf: รุ่น ความจุ มือ', () => {
    expect(templateLabelOf({ model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW' })).toBe('iPhone 15 128GB มือ 1');
    expect(templateLabelOf({ model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED' })).toBe('iPhone 13 128GB มือ 2');
  });
});

describe('computeCardQuote — ตัวคำนวณกลางตัวเดียวกับหน้าราคา (สเปคข้อ 4.5)', () => {
  it('iPhone 15 128GB มือ 1 เครื่องไทย ทุน 25,800 → ตรงชีตทุกบาท', () => {
    const q = computeCardQuote(INPUT)!;
    expect(q.cash?.profit).toBe(100);
    expect(q.rate1).toMatchObject({ downAmount: 3900, monthlyDisplay: 3139, months: 12, recordedSalePrice: 28100, profit: 2300 });
    expect(q.rate2).toMatchObject({ available: true, downAmount: 6500, monthly: 3403, months: 12, submitPrice: 25900, recordedSalePrice: 28738, profit: 2938, originNote: false });
  });

  it('ยังไม่เลือกไทย/นอก → OVER ครึ่งเดียว + originNote', () => {
    const q = computeCardQuote({ ...INPUT, deviceOrigin: '' })!;
    expect(q.rate2).toMatchObject({ available: true, submitPrice: 25400, originNote: true });
  });

  it('ดาวน์กำหนดเองของรุ่นใช้เฉพาะเมื่อราคาผ่อนยังเป็นราคากลาง', () => {
    const template = { ...TEMPLATE, rate1DownPayment: '5000' };
    expect(computeCardQuote({ ...INPUT, template })!.rate1?.downAmount).toBe(5000);
    const edited = computeCardQuote({ ...INPUT, template, fields: { ...INPUT.fields, bc: '26000' } })!;
    expect(edited.rate1?.downAmount).toBe(3900);
  });

  it('ไม่มีทุน → ไม่มีกำไร', () => {
    const q = computeCardQuote({ ...INPUT, costPrice: '' })!;
    expect(q.cash?.profit).toBeNull();
    expect(q.rate1?.profit).toBeNull();
  });

  it('รุ่นที่ไม่มีใบราคา GFIN → gfinBlocked', () => {
    const q = computeCardQuote({ ...INPUT, model: 'iPhone 12', storage: '64GB' });
    expect(q?.rate2).toMatchObject({ available: false, reason: 'NO_PRICE_LIST' });
    expect(gfinBlocked({ ...INPUT, model: 'iPhone 12', storage: '64GB' })).toBe(true);
    expect(gfinBlocked(INPUT)).toBe(false);
  });

  it('gfinBlocked ตัดสินจากใบราคาอย่างเดียว — ช่องราคาว่างหมดก็ยังปิด/เปิดถูก', () => {
    const empty = { cash: '', bc: '', finance: '' };
    expect(gfinBlocked({ ...INPUT, fields: empty, model: 'iPhone 12', storage: '64GB' })).toBe(true);
    expect(gfinBlocked({ ...INPUT, fields: empty })).toBe(false);
    expect(gfinBlocked({ ...INPUT, gfinTables: undefined, model: 'iPhone 12', storage: '64GB' })).toBe(false);
    expect(gfinBlocked({ ...INPUT, category: 'ACCESSORY' })).toBe(false);
    expect(gfinBlocked({ ...INPUT, model: '' })).toBe(false);
  });

  it('เครื่องนอก → ครึ่ง OVER แต่ไม่ใช่ originNote (เลือกแล้ว)', () => {
    const q = computeCardQuote({ ...INPUT, deviceOrigin: 'IMPORTED' })!;
    expect(q.rate2).toMatchObject({ available: true, submitPrice: 25400, originNote: false });
  });

  it('แท็บเล็ต → คอม 5% ผ่าน toModelQuoteGfinContext', () => {
    const ctx = toModelQuoteGfinContext(gfinTables, 'TABLET');
    expect(ctx.commissionPct).toBe(5);
    expect(ctx.settingMinDownPct.toNumber()).toBe(0.25);
    expect(toModelQuoteGfinContext(gfinTables, 'PHONE_NEW').commissionPct).toBe(15);
  });

  it('กำไรติดลบคงติดลบ · ทุนว่างช่องว่าง/มีคอมมา', () => {
    expect(computeCardQuote({ ...INPUT, costPrice: '26000' })!.cash?.profit).toBe(-100);
    expect(computeCardQuote({ ...INPUT, costPrice: '   ' })!.cash?.profit).toBeNull();
    expect(computeCardQuote({ ...INPUT, costPrice: '25,800' })!.cash?.profit).toBe(100);
  });

  it('ยังไม่เลือกยี่ห้อ → null', () => {
    expect(computeCardQuote({ ...INPUT, brand: '' })).toBeNull();
  });

  it('อุปกรณ์เสริม / ยังไม่เลือกรุ่น → null', () => {
    expect(computeCardQuote({ ...INPUT, category: 'ACCESSORY' })).toBeNull();
    expect(computeCardQuote({ ...INPUT, model: '' })).toBeNull();
  });
});

describe('payload ของหน้าเพิ่มสินค้า', () => {
  it('มือถือ: 3 คอลัมน์ · ช่องว่าง = null · GFIN ไม่รับรุ่นนี้ = null', () => {
    const fields = { cash: '25900', bc: '', finance: '25900' };
    expect(toPricePayload('PHONE_NEW', fields, { gfinBlocked: false })).toEqual({ cashPrice: 25900, installmentPrice: null, financePrice: 25900 });
    expect(toPricePayload('PHONE_NEW', fields, { gfinBlocked: true }).financePrice).toBeNull();
  });

  it('อุปกรณ์เสริม: เฉพาะ cashPrice', () => {
    expect(toPricePayload('ACCESSORY', { cash: '290', bc: '5', finance: '5' }, { gfinBlocked: false })).toEqual({ cashPrice: 290 });
  });

  it('hasAnyPrice: ต้องมีอย่างน้อย 1 ช่อง', () => {
    expect(hasAnyPrice({ cashPrice: null, installmentPrice: null, financePrice: null })).toBe(false);
    expect(hasAnyPrice({ cashPrice: null, installmentPrice: 9000, financePrice: null })).toBe(true);
  });

  it('accessoryProfit: ราคาขาย − ทุน · ไม่มีทุนหรือราคา = null', () => {
    expect(accessoryProfit('290', '25')).toBe(265);
    expect(accessoryProfit('290', '')).toBeNull();
    expect(accessoryProfit('', '25')).toBeNull();
  });
});
