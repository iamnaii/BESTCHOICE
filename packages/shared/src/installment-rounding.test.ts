import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import {
  DOWN_PAYMENT_STEP,
  downFromPct,
  minDownAmountFromPct,
  roundUpToStep,
} from './installment-rounding';

describe('roundUpToStep', () => {
  it('ปัดขึ้นเป็นหลักร้อย', () => {
    expect(DOWN_PAYMENT_STEP).toBe(100);
    expect(roundUpToStep(new Decimal('3885')).toFixed(2)).toBe('3900.00');
    expect(roundUpToStep(new Decimal('0.01')).toFixed(2)).toBe('100.00');
  });

  it('ค่าที่ลงหลักร้อยพอดีและศูนย์ไม่เปลี่ยน', () => {
    expect(roundUpToStep(new Decimal('3900')).toFixed(2)).toBe('3900.00');
    expect(roundUpToStep(new Decimal('0')).toFixed(2)).toBe('0.00');
  });
});

describe('downFromPct', () => {
  it('ตัวเลขจากชีต MASTER: 25,900 × 15% = 3,885 → 3,900', () => {
    expect(downFromPct(new Decimal('25900'), new Decimal('0.15')).toFixed(2)).toBe('3900.00');
  });

  it('ตัวอย่างมาตรฐานของเทสต์เดิม: 19,900 × 15% = 2,985 → 3,000', () => {
    expect(downFromPct(new Decimal('19900'), new Decimal('0.15')).toFixed(2)).toBe('3000.00');
  });

  it('ลงหลักร้อยพอดีไม่เปลี่ยน: 10,000 × 20% = 2,000', () => {
    expect(downFromPct(new Decimal('10000'), new Decimal('0.20')).toFixed(2)).toBe('2000.00');
  });

  it('ราคาต่ำจนปัดแล้วไม่น้อยกว่าราคา → ใช้ค่าก่อนปัด (90 × 30% = 27)', () => {
    expect(downFromPct(new Decimal('90'), new Decimal('0.30')).toFixed(2)).toBe('27.00');
  });

  it('ราคาต่ำแต่ปัดแล้วยังน้อยกว่าราคา → ปัด (290 × 30% = 87 → 100)', () => {
    expect(downFromPct(new Decimal('290'), new Decimal('0.30')).toFixed(2)).toBe('100.00');
  });

  it('% เป็นศูนย์ → 0', () => {
    expect(downFromPct(new Decimal('19900'), new Decimal('0')).toFixed(2)).toBe('0.00');
  });
});

describe('minDownAmountFromPct', () => {
  it('รับ/คืนเป็น number สำหรับหน้าเว็บ', () => {
    expect(minDownAmountFromPct(19900, 0.15)).toBe(3000);
    expect(minDownAmountFromPct(25900, 0.15)).toBe(3900);
  });
});
