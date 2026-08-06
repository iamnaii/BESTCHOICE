import { describe, it, expect } from 'vitest';
import { annualTaxFromNetIncome, suggestMonthlyWht } from './pit-withholding';

describe('annualTaxFromNetIncome — ขั้นบันได ม.48', () => {
  it('ยกเว้นช่วง 0-150,000', () => {
    expect(annualTaxFromNetIncome(0)).toBe(0);
    expect(annualTaxFromNetIncome(150_000)).toBe(0);
  });

  it('ขั้น 5%: สุทธิ 300,000 → 7,500', () => {
    expect(annualTaxFromNetIncome(300_000)).toBe(7_500);
  });

  it('ขั้น 10%: สุทธิ 500,000 → 7,500 + 20,000 = 27,500', () => {
    expect(annualTaxFromNetIncome(500_000)).toBe(27_500);
  });

  it('ขั้น 15%: สุทธิ 750,000 → 27,500 + 37,500 = 65,000', () => {
    expect(annualTaxFromNetIncome(750_000)).toBe(65_000);
  });

  it('ขั้น 20%: สุทธิ 1,000,000 → 65,000 + 50,000 = 115,000', () => {
    expect(annualTaxFromNetIncome(1_000_000)).toBe(115_000);
  });

  it('ค่ากลางขั้น: สุทธิ 200,000 → (200,000−150,000)×5% = 2,500', () => {
    expect(annualTaxFromNetIncome(200_000)).toBe(2_500);
  });
});

describe('suggestMonthlyWht — ลดหย่อนมาตรฐาน + หารรายเดือน', () => {
  it('เงินเดือน 15,000 (ต่ำกว่าเกณฑ์) → 0', () => {
    // ปี 180,000 − ค่าใช้จ่าย 90,000 − ส่วนตัว 60,000 − ปกส. 9,000 = 21,000 → ยกเว้น
    expect(suggestMonthlyWht(15_000, 750)).toBe(0);
  });

  it('เงินเดือน 30,000 + ปกส. 750 → 170.83/เดือน', () => {
    // ปี 360,000 − 100,000 − 60,000 − 9,000 = 191,000
    // ภาษี = (191,000−150,000)×5% = 2,050 → /12 = 170.83
    expect(suggestMonthlyWht(30_000, 750)).toBe(170.83);
  });

  it('เงินเดือน 50,000 + ปกส. 875 → ขั้น 10%', () => {
    // ปี 600,000 − 100,000 − 60,000 − 10,500 = 429,500
    // ภาษี = 7,500 + (429,500−300,000)×10% = 20,450 → /12 = 1,704.17
    expect(suggestMonthlyWht(50_000, 875)).toBe(1_704.17);
  });

  it('ค่าพัง/ติดลบ → 0 (advisory ห้ามระเบิด)', () => {
    expect(suggestMonthlyWht(NaN, 0)).toBe(0);
    expect(suggestMonthlyWht(-5, 100)).toBe(0);
    expect(suggestMonthlyWht(10_000, NaN)).toBe(0);
  });
});
