import { describe, it, expect } from 'vitest';
import {
  coaScopeOf,
  coaCodePrefix,
  coaSectionLabel,
  validateCoaCodeForScope,
} from './coa-partition';

describe('coa-partition — แยกฝั่งผังบัญชี SHOP/FINANCE', () => {
  it('coaScopeOf: S-prefix = SHOP, ตัวเลข = FINANCE', () => {
    expect(coaScopeOf('11-1101')).toBe('FINANCE');
    expect(coaScopeOf('S52-1201')).toBe('SHOP');
  });

  it('coaCodePrefix: S52-1201 → "S52" (บั๊กเดิมได้ "S5"), 11-1101 → "11"', () => {
    expect(coaCodePrefix('11-1101')).toBe('11');
    expect(coaCodePrefix('S52-1201')).toBe('S52');
    expect(coaCodePrefix('S11-3001')).toBe('S11');
  });

  it('coaSectionLabel: ครอบคลุมทั้งสองผัง + fallback', () => {
    expect(coaSectionLabel('11')).toBe('สินทรัพย์หมุนเวียน');
    expect(coaSectionLabel('S52')).toBe('ค่าใช้จ่ายบริหารสาขา (SHOP)');
    expect(coaSectionLabel('S21')).toBe('หนี้สินหมุนเวียน (SHOP)');
    expect(coaSectionLabel('99')).toBe('หมวด 99');
  });

  it('validateCoaCodeForScope: กันสร้างบัญชีผิดฝั่ง (ต้นเหตุ 42-1199 หลงผัง)', () => {
    expect(validateCoaCodeForScope('11-1199', 'FINANCE')).toBeNull();
    expect(validateCoaCodeForScope('S52-1206', 'SHOP')).toBeNull();
    expect(validateCoaCodeForScope('S52-1206', 'FINANCE')).toMatch(/สลับแท็บ SHOP/);
    expect(validateCoaCodeForScope('42-1199', 'SHOP')).toMatch(/ขึ้นต้นด้วย S/);
    expect(validateCoaCodeForScope('abc', 'FINANCE')).toMatch(/XX-XXXX/);
    expect(validateCoaCodeForScope('S1-11', 'SHOP')).toMatch(/SXX-XXXX/);
  });
});
