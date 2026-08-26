import { Prisma } from '@prisma/client';

import { nextNumberFrom, sumLine } from './_helpers';

describe('nextNumberFrom', () => {
  it('เริ่มที่ 0001 เมื่อยังไม่มีเลขในวันนั้น', () => {
    expect(nextNumberFrom('EX-20260826-', null)).toBe('EX-20260826-0001');
  });

  it('เดินต่อจากเลขล่าสุด (max+1 ไม่ใช่ count+1)', () => {
    expect(nextNumberFrom('EX-20260826-', 'EX-20260826-0042')).toBe('EX-20260826-0043');
  });

  it('เลขเสียกลับไปเริ่มที่ 0001 แทนที่จะได้ NaN', () => {
    expect(nextNumberFrom('EX-20260826-', 'EX-20260826-abcd')).toBe('EX-20260826-0001');
  });

  it('รองรับความกว้างอื่น เช่น RT- ที่ใช้ 5 หลัก', () => {
    expect(nextNumberFrom('RT-202608-', 'RT-202608-00007', 5)).toBe('RT-202608-00008');
  });
});

describe('sumLine', () => {
  it('คิดยอดก่อน VAT และ VAT แยกกัน ปัด 2 ตำแหน่ง — คืนค่าเป็น Prisma.Decimal', () => {
    const s = sumLine(1000, 3, 7);
    expect(s.amountBeforeVat).toBeInstanceOf(Prisma.Decimal);
    expect(s.vatAmount).toBeInstanceOf(Prisma.Decimal);
    expect(s.total).toBeInstanceOf(Prisma.Decimal);
    expect(s.amountBeforeVat.toFixed(2)).toBe('3000.00');
    expect(s.vatAmount.toFixed(2)).toBe('210.00');
    expect(s.total.toFixed(2)).toBe('3210.00');
  });

  it('VAT 0 = ไม่มีภาษี (ฝั่ง SHOP ไม่จด VAT)', () => {
    const s = sumLine(1500, 2, 0);
    expect(s.amountBeforeVat.toFixed(2)).toBe('3000.00');
    expect(s.vatAmount.toFixed(2)).toBe('0.00');
    expect(s.total.toFixed(2)).toBe('3000.00');
  });

  it('ปัดเศษ VAT แบบ 2 ตำแหน่ง ไม่ปล่อยทศนิยมลอย (333.33 × 7% → 23.33)', () => {
    const s = sumLine(333.33, 1, 7);
    expect(s.amountBeforeVat.toFixed(2)).toBe('333.33');
    expect(s.vatAmount.toFixed(2)).toBe('23.33');
    expect(s.total.toFixed(2)).toBe('356.66');
  });
});
