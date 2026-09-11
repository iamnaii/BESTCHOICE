import { describe, it, expect } from 'vitest';
import { buildBcQuote } from './bcQuote';

// golden config เดียวกับ BcCalculatorCard.test.tsx / useCustomerSummary.test.ts
const config = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 5: 0.4, 6: 0.4, 7: 0.5, 8: 0.5, 10: 0.5, 12: 0.5 },
  allowedMonths: [12, 5, 6, 7, 8, 10],
};

describe('buildBcQuote', () => {
  it('19,900 · 12 งวด · ดาวน์ขั้นต่ำ 15% = 2,985 → 2,413.20/เดือน และตัวเลือกงวดเรียงจากน้อยไปมากพร้อมค่างวด', () => {
    const q = buildBcQuote(config, 19900, 12, 2985);
    expect(q.minDownAmount).toBe(2985);
    expect(q.result.isValid).toBe(true);
    expect(q.result.monthlyPayment.toNumber()).toBeCloseTo(2413.2, 2);
    expect(q.monthsOptions.map((o) => o.months)).toEqual([5, 6, 7, 8, 10, 12]);
    expect(q.monthsOptions[5].monthly).toBeCloseTo(2413.2, 2);
    expect(q.monthsOptions[0].monthly).toBeGreaterThan(q.monthsOptions[5].monthly);
  });

  it('ดาวน์ต่ำกว่าขั้นต่ำ → result.isValid=false แต่ตัวเลือกงวดยังคำนวณจากดาวน์ที่กรอก', () => {
    const q = buildBcQuote(config, 19900, 12, 1000);
    expect(q.result.isValid).toBe(false);
    expect(q.monthsOptions).toHaveLength(6);
  });
});
