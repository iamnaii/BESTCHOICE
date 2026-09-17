import { normalizeThaiPhone } from './thai-phone.util';

describe('normalizeThaiPhone', () => {
  it.each([
    ['081-234 5678', '0812345678'],
    ['(081) 234 5678', '0812345678'],
    ['+66812345678', '0812345678'],
    ['+66 81 234 5678', '0812345678'],
    ['66812345678', '0812345678'],
    ['0812345678', '0812345678'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeThaiPhone(raw)).toBe(expected);
  });

  it('66 นำหน้าแต่ไม่ครบ 11 หลัก → ไม่แปลง (ไม่ใช่รหัสประเทศ)', () => {
    expect(normalizeThaiPhone('6612345')).toBe('6612345');
  });

  it('ว่าง/null/undefined → null · มีแต่ช่องว่าง/ขีด → สตริงว่าง (พฤติกรรมเดิมของ CustomerWriteService)', () => {
    expect(normalizeThaiPhone(null)).toBeNull();
    expect(normalizeThaiPhone(undefined)).toBeNull();
    expect(normalizeThaiPhone('')).toBeNull();
    expect(normalizeThaiPhone('  - ')).toBe('');
  });
});
