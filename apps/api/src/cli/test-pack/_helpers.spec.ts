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
  // ยืนยันด้วย .toString() (ค่าที่เก็บจริง) — ห้ามใช้ .toFixed(2) เพราะมันปัดเศษใน assertion เอง:
  // ถ้า round2 หายไปจนได้ 23.3331 มา .toFixed(2) ยังพิมพ์ '23.33' แล้วเทสผ่านทั้งที่ค่าผิด
  it('คิดยอดก่อน VAT และ VAT แยกกัน ปัด 2 ตำแหน่ง — คืนค่าเป็น Prisma.Decimal', () => {
    const s = sumLine(1000, 3, 7);
    expect(s.amountBeforeVat).toBeInstanceOf(Prisma.Decimal);
    expect(s.vatAmount).toBeInstanceOf(Prisma.Decimal);
    expect(s.total).toBeInstanceOf(Prisma.Decimal);
    expect(s.amountBeforeVat.toString()).toBe('3000');
    expect(s.vatAmount.toString()).toBe('210');
    expect(s.total.toString()).toBe('3210');
  });

  it('VAT 0 = ไม่มีภาษี (ฝั่ง SHOP ไม่จด VAT)', () => {
    const s = sumLine(1500, 2, 0);
    expect(s.amountBeforeVat.toString()).toBe('3000');
    expect(s.vatAmount.toString()).toBe('0');
    expect(s.total.toString()).toBe('3000');
  });

  it('ปัดเศษ VAT แบบ 2 ตำแหน่ง ไม่ปล่อยทศนิยมลอย (333.33 × 7% → 23.33)', () => {
    const s = sumLine(333.33, 1, 7);
    expect(s.amountBeforeVat.toString()).toBe('333.33');
    expect(s.vatAmount.toString()).toBe('23.33');
    expect(s.total.toString()).toBe('356.66');
  });
});
