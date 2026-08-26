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
  it('คิดยอดก่อน VAT และ VAT แยกกัน ปัด 2 ตำแหน่ง', () => {
    expect(sumLine(1000, 3, 7)).toEqual({ amountBeforeVat: 3000, vatAmount: 210, total: 3210 });
  });

  it('VAT 0 = ไม่มีภาษี (ฝั่ง SHOP ไม่จด VAT)', () => {
    expect(sumLine(1500, 2, 0)).toEqual({ amountBeforeVat: 3000, vatAmount: 0, total: 3000 });
  });

  it('ปัดเศษ VAT แบบ 2 ตำแหน่ง ไม่ปล่อยทศนิยมลอย', () => {
    expect(sumLine(333.33, 1, 7)).toEqual({
      amountBeforeVat: 333.33,
      vatAmount: 23.33,
      total: 356.66,
    });
  });
});
