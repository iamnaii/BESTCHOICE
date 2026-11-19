import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { calcBcInstallment } from '@installment/shared';
import { previewBcConfig, previewMonths, totalInterestPct, validateRateRows } from './rate-rows';

describe('validateRateRows', () => {
  it('ตารางว่างผ่าน', () => {
    expect(validateRateRows([], 6, 12)).toBeNull();
  });

  it('ตารางที่ถูกต้องผ่าน', () => {
    expect(validateRateRows([{ months: 10, ratePct: 50 }, { months: 12, ratePct: 50 }], 6, 12)).toBeNull();
  });

  it('งวดไม่เป็นจำนวนเต็มหรือน้อยกว่า 1', () => {
    expect(validateRateRows([{ months: 10.5, ratePct: 50 }], 6, 12)).toBe('จำนวนงวดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
    expect(validateRateRows([{ months: 0, ratePct: 50 }], 6, 12)).toBe('จำนวนงวดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
  });

  it('งวดซ้ำ', () => {
    expect(validateRateRows([{ months: 12, ratePct: 50 }, { months: 12, ratePct: 40 }], 6, 12)).toBe(
      'จำนวนงวดซ้ำกัน: 12 งวด',
    );
  });

  it('งวดนอกช่วง', () => {
    expect(validateRateRows([{ months: 15, ratePct: 60 }], 6, 12)).toBe(
      '15 งวด อยู่นอกช่วงงวดต่ำสุด–สูงสุด (6–12 งวด)',
    );
  });

  it('ดอกเบี้ยรวมต้องมากกว่า 0 และไม่เกิน 999.99', () => {
    expect(validateRateRows([{ months: 12, ratePct: 0 }], 6, 12)).toBe('ดอกเบี้ยรวมต้องมากกว่า 0% และไม่เกิน 999.99%');
    expect(validateRateRows([{ months: 12, ratePct: 1000 }], 6, 12)).toBe(
      'ดอกเบี้ยรวมต้องมากกว่า 0% และไม่เกิน 999.99%',
    );
  });
});

describe('previewMonths', () => {
  it('ไม่มีตาราง → งวดสูงสุด', () => {
    expect(previewMonths([], 12)).toBe(12);
  });

  it('มีตารางและมี 12 งวด → 12', () => {
    expect(previewMonths([{ months: 10 }, { months: 12 }], 15)).toBe(12);
  });

  it('มีตารางแต่ไม่มี 12 งวด → งวดมากสุดในตาราง', () => {
    expect(previewMonths([{ months: 6 }, { months: 10 }], 15)).toBe(10);
  });
});

describe('totalInterestPct', () => {
  it('มีแถวของงวดนั้น → ใช้ค่าในแถว', () => {
    expect(totalInterestPct([{ months: 12, ratePct: 50 }], 8, 12)).toBe(50);
  });

  it('ไม่มีตาราง → ดอกเบี้ยต่อเดือน × งวด', () => {
    expect(totalInterestPct([], 5, 12)).toBe(60);
  });
});

describe('previewBcConfig', () => {
  const base = { minDownPct: 15, commissionPct: 10, vatPct: 0.07, monthlyRatePct: 5 };

  it('มีตาราง → ใช้อัตราในตารางและงวดตามตาราง · ตัวเลขตรงเครื่องคิดเลขกลาง', () => {
    const rows = [{ months: 10, ratePct: 50 }, { months: 12, ratePct: 50 }];
    const config = previewBcConfig({ ...base, rows, months: 12 });
    expect(config.allowedMonths).toEqual([10, 12]);
    expect(config.ratePctByMonths.get(12)?.toString()).toBe('0.5');
    expect(config.minDownPct.toString()).toBe('0.15');
    expect(config.commissionPct.toString()).toBe('0.1');
    const out = calcBcInstallment({ installmentPrice: new Decimal(12900), months: 12, config });
    expect(out.errors).toEqual([]);
    expect(out.downAmount.toString()).toBe('2000');
    expect(out.interestAmount.toString()).toBe('5450');
    expect(out.monthlyPayment.toFixed(2)).toBe('1555.06');
  });

  it('ไม่มีตาราง → ต่อเดือน × งวด สำหรับงวดตัวอย่าง', () => {
    const config = previewBcConfig({ ...base, rows: [], months: 12 });
    expect(config.allowedMonths).toEqual([12]);
    expect(config.ratePctByMonths.get(12)?.toString()).toBe('0.6');
  });
});
