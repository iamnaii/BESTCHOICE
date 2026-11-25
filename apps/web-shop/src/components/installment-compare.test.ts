import { describe, expect, it } from 'vitest';
import { compareBadges, isFreeDown } from './installment-compare';

const q = (downAmount: number, monthlyPayment: number, months: number) => ({
  available: true,
  downAmount,
  monthlyPayment,
  months,
});

describe('compareBadges', () => {
  it('บอกเฉพาะข้อที่ดีกว่าอีกเรทจริง', () => {
    const rate1 = q(6000, 4848, 12);
    const rate2 = q(5900, 4821, 15);
    expect(compareBadges(rate1, rate2)).toEqual(['ผ่อนจบเร็วกว่า']);
    expect(compareBadges(rate2, rate1)).toEqual(['ดาวน์น้อยกว่า', 'ค่างวดต่ำกว่า']);
  });

  it('ดาวน์ 0 ใช้ป้าย "ฟรีดาวน์" แทน "ดาวน์น้อยกว่า"', () => {
    expect(compareBadges(q(0, 4061, 15), q(4485, 2890, 12))).toEqual(['ฟรีดาวน์']);
    expect(compareBadges(q(4485, 2890, 12), q(0, 4061, 15))).toEqual(['ค่างวดต่ำกว่า', 'ผ่อนจบเร็วกว่า']);
  });

  it('เทียบค่างวดหลังปัดขึ้นเป็นบาทเต็ม — ต่างกันแค่เศษสตางค์ไม่ขึ้นป้าย', () => {
    expect(compareBadges(q(3000, 1234.2, 12), q(3000, 1234.9, 12))).toEqual([]);
  });

  it('อีกเรทคิดไม่ได้ → ไม่มีป้ายเปรียบเทียบ (เหลือแต่ฟรีดาวน์ถ้าดาวน์ 0)', () => {
    expect(compareBadges(q(3000, 2000, 12), { available: false })).toEqual([]);
    expect(compareBadges(q(0, 2000, 12), undefined)).toEqual(['ฟรีดาวน์']);
    expect(compareBadges({ available: false }, q(3000, 2000, 12))).toEqual([]);
  });
});

describe('isFreeDown', () => {
  it('จริงเมื่อคิดได้และดาวน์เป็น 0', () => {
    expect(isFreeDown(q(0, 4061, 15))).toBe(true);
    expect(isFreeDown(q(100, 4061, 15))).toBe(false);
    expect(isFreeDown({ available: false })).toBe(false);
    expect(isFreeDown(undefined)).toBe(false);
  });
});

describe('ฟิลด์ขาด (สัญญาจาก API ไม่ครบ)', () => {
  it('downAmount ไม่มี → ไม่ใช่ฟรีดาวน์', () => {
    expect(isFreeDown({ available: true, monthlyPayment: 2000, months: 12 })).toBe(false);
    expect(compareBadges({ available: true, monthlyPayment: 2000, months: 12 }, undefined)).toEqual([]);
  });

  it('months ของฝั่งเราไม่มี → ไม่ขึ้น "ผ่อนจบเร็วกว่า"', () => {
    const mine = { available: true, downAmount: 3000, monthlyPayment: 2000 };
    expect(compareBadges(mine, q(3000, 2000, 12))).toEqual([]);
    expect(compareBadges(q(3000, 2000, 12), { ...mine })).toEqual([]);
  });

  it('ค่างวดของฝั่งเราไม่มี → ไม่ขึ้น "ค่างวดต่ำกว่า"', () => {
    const mine = { available: true, downAmount: 3000, months: 12 };
    expect(compareBadges(mine, q(3000, 2000, 12))).toEqual([]);
  });
});
