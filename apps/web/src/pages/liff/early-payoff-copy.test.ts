import { describe, it, expect } from 'vitest';
import { earlyPayoffDiscountCopy } from './early-payoff-copy';

describe('earlyPayoffDiscountCopy — ข้อความบนไลน์ต้องตามส่วนลดจริง (ฝ่ายบัญชี 16/10/2569 ข้อ 18.1)', () => {
  it('ส่วนลด > 0 ไม่มีงวดถึงกำหนด → ข้อความเดิม % ตามที่ API ส่ง', () => {
    const c = earlyPayoffDiscountCopy({ discount: 10740.04, discountPct: 50, dueMonths: 0 });
    expect(c.badge).toBe('ส่วนลดพิเศษ 50%');
    expect(c.sectionLabel).toBe('ยอดปิดสัญญา · ส่วนลด 50%');
    expect(c.rowLabel).toBe('ส่วนลดพิเศษ 50%');
    expect(c.note).toBeNull();
    expect(c.infoNote).toContain('ส่วนลดพิเศษ 50%');
  });

  it('มีงวดถึงกำหนดแล้ว → บอกว่าลดเฉพาะงวดที่ยังไม่ถึงกำหนด + จำนวนงวดที่ชำระเต็ม', () => {
    const c = earlyPayoffDiscountCopy({ discount: 7160.03, discountPct: 50, dueMonths: 4 });
    expect(c.rowLabel).toBe('ส่วนลดพิเศษ 50% ของงวดที่ยังไม่ถึงกำหนด');
    expect(c.note).toContain('งวดที่ถึงกำหนดแล้ว 4 งวด');
    expect(c.infoNote).toContain('งวดที่ยังไม่ถึงกำหนด');
  });

  it('ส่วนลด 0 (ทุกงวดถึงกำหนดแล้ว) → ไม่อ้าง % ที่ไหนเลย', () => {
    const c = earlyPayoffDiscountCopy({ discount: 0, discountPct: 50, dueMonths: 12 });
    for (const s of [c.badge, c.sectionLabel, c.rowLabel, c.infoNote, c.note ?? '']) {
      expect(s).not.toContain('%');
    }
    expect(c.badge).toBe('ปิดยอดก่อนกำหนด');
    expect(c.sectionLabel).toBe('ยอดปิดสัญญา');
    expect(c.note).toContain('12 งวด');
  });

  it('API เก่าไม่ส่ง % → ไม่เดา 50', () => {
    const c = earlyPayoffDiscountCopy({ discount: 100 });
    for (const s of [c.badge, c.sectionLabel, c.rowLabel, c.infoNote]) {
      expect(s).not.toContain('50');
    }
    expect(c.badge).toBe('ส่วนลดพิเศษ');
    expect(c.note).toBeNull();
  });
});
