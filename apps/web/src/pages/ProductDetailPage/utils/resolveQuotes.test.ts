import { describe, it, expect } from 'vitest';
import { resolveQuotes } from './resolveQuotes';
import { INITIAL_CALC_STATE } from '../hooks/useInstallmentCalcState';
import type { GfinTables } from './gfinQuote';

const bcConfig = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 5: 0.4, 6: 0.4, 7: 0.5, 8: 0.5, 10: 0.5, 12: 0.5 },
  allowedMonths: [5, 6, 7, 8, 10, 12],
};

const gfinTables: GfinTables = {
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
  ],
  settings: {
    minDownPct: 25,
    maxDownPct: 80,
    downStepPct: 5,
    contractFee: 100,
    commissionPctByCategory: { PHONE: 15, TABLET: 5 },
  },
};

const product = {
  id: 'p1',
  category: 'PHONE_NEW',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  cashPrice: '19900',
  installmentPrice: '19900',
  prices: [],
};

describe('resolveQuotes', () => {
  it('ค่าตั้งต้น: BESTCHOICE 12 งวด ดาวน์ขั้นต่ำ 2,985 → 2,413.20 · GFIN 12 งวด ดาวน์ 25% คอม 15 → 3,327', () => {
    const r = resolveQuotes({ product, state: INITIAL_CALC_STATE, bcConfig, gfinTables });
    expect(r.installmentPrice).toBe(19900);
    expect(r.bc).not.toBeNull();
    expect(r.bc!.months).toBe(12);
    expect(r.bc!.downAmount).toBe(2985);
    expect(r.bc!.quote.result.monthlyPayment.toNumber()).toBeCloseTo(2413.2, 2);
    expect(r.gfin).not.toBeNull();
    expect(r.gfin!.months).toBe(12);
    expect(r.gfin!.downPct).toBe(25);
    expect(r.gfin!.commissionPct).toBe(15);
    expect(r.gfinAvailable).toBe(true);
    expect(r.gfin!.quote.available && r.gfin!.quote.result.monthlyPayment.toNumber()).toBe(3327);
  });

  it('state ทับค่าตั้งต้น · งวด GFIN ที่เลือกเกินเพดาน (15 > 12) → ถอยกลับไปงวดตั้งต้นจากตัวเลือกที่มี', () => {
    const r = resolveQuotes({
      product,
      state: {
        fin: 'gfin',
        bc: { months: 10, downAmount: 5000 },
        gfin: { months: 15, downPct: 30, commissionPct: 15 },
      },
      bcConfig,
      gfinTables,
    });
    expect(r.bc!.months).toBe(10);
    expect(r.bc!.downAmount).toBe(5000);
    expect(r.gfin!.months).toBe(12);
    expect(r.gfin!.downPct).toBe(30);
    expect(r.gfin!.quote.available).toBe(true);
  });

  it('ไม่มีราคาผ่อน → installmentPrice null และไม่มี quote ทั้งสองฝั่ง', () => {
    const r = resolveQuotes({
      product: { ...product, installmentPrice: null, cashPrice: '15900' },
      state: INITIAL_CALC_STATE,
      bcConfig,
      gfinTables,
    });
    expect(r.installmentPrice).toBeNull();
    expect(r.bc).toBeNull();
    expect(r.gfin).toBeNull();
    expect(r.gfinAvailable).toBe(false);
  });

  it('ไม่มี bcConfig (ยังโหลด) → bc null แต่ GFIN ยังคำนวณได้ · รุ่นไม่อยู่ในตาราง GFIN → gfinAvailable=false', () => {
    const r = resolveQuotes({ product, state: INITIAL_CALC_STATE, gfinTables });
    expect(r.bc).toBeNull();
    expect(r.gfin!.quote.available).toBe(true);

    const samsung = { ...product, brand: 'Samsung', model: 'Galaxy S24', storage: '256GB', category: 'PHONE_USED' };
    const r2 = resolveQuotes({ product: samsung, state: INITIAL_CALC_STATE, bcConfig, gfinTables });
    expect(r2.gfinAvailable).toBe(false);
    expect(r2.gfin!.quote.available).toBe(false);
  });
});
