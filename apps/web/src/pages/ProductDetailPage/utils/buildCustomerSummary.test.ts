import { describe, it, expect } from 'vitest';
import {
  formatBaht,
  computeDefaultBcInstallment,
  buildCustomerSummary,
  buildShopProductUrl,
} from './buildCustomerSummary';

const config = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 5: 0.4, 6: 0.4, 7: 0.5, 8: 0.5, 10: 0.5, 12: 0.5 },
  allowedMonths: [5, 6, 7, 8, 10, 12],
};

describe('formatBaht', () => {
  it('ตัด .00 ทิ้งและใส่ตัวคั่นหลักพัน', () => {
    expect(formatBaht(15900)).toBe('15,900');
    expect(formatBaht(0)).toBe('0');
    expect(formatBaht(1234567)).toBe('1,234,567');
  });

  it('เก็บทศนิยม 2 ตำแหน่งเมื่อมีเศษ', () => {
    expect(formatBaht(2413.21)).toBe('2,413.21');
    expect(formatBaht(99.5)).toBe('99.50');
  });

  it('NaN/Infinity ไม่หลุดออกจอเป็น "NaN.undefined" — คืน "-" แทน', () => {
    expect(formatBaht(NaN)).toBe('-');
    expect(formatBaht(Infinity)).toBe('-');
    expect(formatBaht(-Infinity)).toBe('-');
  });
});

describe('computeDefaultBcInstallment — golden 19,900 (ตรงกับ BcCalculatorCard)', () => {
  it('คืน 12 งวด ดาวน์ 2,985 งวดละ 2,413.21', () => {
    expect(computeDefaultBcInstallment(19900, config)).toEqual({
      months: 12,
      downAmount: 2985,
      monthlyPayment: 2413.21,
    });
  });

  it('ไม่มี 12 งวดในตาราง → ใช้งวดแรกที่อนุญาต', () => {
    const out = computeDefaultBcInstallment(19900, { ...config, allowedMonths: [6, 10] });
    expect(out?.months).toBe(6);
  });

  it('ไม่มีราคาผ่อน / ไม่มี config → null', () => {
    expect(computeDefaultBcInstallment(null, config)).toBeNull();
    expect(computeDefaultBcInstallment(0, config)).toBeNull();
    expect(computeDefaultBcInstallment(19900, null)).toBeNull();
    expect(computeDefaultBcInstallment(19900, { ...config, allowedMonths: [] })).toBeNull();
  });

  it('config เสีย (minDownPct/vatPct เป็น NaN) → null ไม่ใช่ NaN (decimal.js ไม่ throw บน NaN)', () => {
    expect(computeDefaultBcInstallment(19900, { ...config, minDownPct: NaN })).toBeNull();
    expect(computeDefaultBcInstallment(19900, { ...config, vatPct: NaN })).toBeNull();
  });
});

describe('buildCustomerSummary', () => {
  it('ประกอบข้อความครบทุกส่วนเมื่อข้อมูลครบ', () => {
    const text = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 13',
      storage: '128GB',
      color: 'Black', // product.color เก็บค่าอังกฤษดิบ (VariantSelector IPHONE_COLORS.value) — ไม่ใช่ label ไทย
      category: 'PHONE_USED',
      conditionGrade: 'A',
      batteryHealth: 89,
      shopWarrantyDays: 30,
      accessoriesIncluded: ['สายชาร์จ', 'กล่อง'],
      cosmeticNotes: 'รอยขีดข่วนมุมล่างซ้าย',
      cashPrice: '15900',
      installmentPrice: '19900',
      installment: { months: 12, downAmount: 2985, monthlyPayment: 2413.21 },
      branchName: 'ลาดพร้าว',
      imeiSerial: '356789012341234',
      link: 'https://www.bestchoicephone.com/products/p-1',
    });

    expect(text).toBe(
      [
        'Apple iPhone 13 128GB สีดำ (เครื่องมือสอง เกรด A)',
        'ราคาเงินสด 15,900 บาท',
        'ผ่อน 12 งวด ดาวน์ 2,985 บาท งวดละ 2,413.21 บาท',
        'แบต 89% | ประกันร้าน 30 วัน | อุปกรณ์: สายชาร์จ, กล่อง',
        'ตำหนิ: รอยขีดข่วนมุมล่างซ้าย',
        'สาขา ลาดพร้าว | เลขเครื่อง 4 ตัวท้าย 1234',
        'ดูรายละเอียด: https://www.bestchoicephone.com/products/p-1',
      ].join('\n'),
    );
  });

  it('ข้ามบรรทัดผ่อนเมื่อไม่มีราคาผ่อน', () => {
    const text = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 13',
      category: 'PHONE_NEW',
      cashPrice: 20900,
      installmentPrice: null,
      installment: null,
    });
    expect(text).toBe(['Apple iPhone 13 (เครื่องใหม่)', 'ราคาเงินสด 20,900 บาท'].join('\n'));
    expect(text).not.toContain('ผ่อน');
  });

  it('ไม่มีราคาเงินสด → บอกให้สอบถามแทนที่จะโชว์ 0', () => {
    const text = buildCustomerSummary({ brand: 'Apple', model: 'iPhone 13', cashPrice: null });
    expect(text).toContain('ราคาเงินสด สอบถามแอดมิน');
    expect(text).not.toContain('0 บาท');
  });

  it('null ทุกฟิลด์ก็ไม่พัง — ได้อย่างน้อย 2 บรรทัด', () => {
    const text = buildCustomerSummary({
      brand: null,
      model: null,
      storage: null,
      color: null,
      category: null,
      conditionGrade: null,
      batteryHealth: null,
      shopWarrantyDays: null,
      accessoriesIncluded: null,
      cosmeticNotes: null,
      cashPrice: null,
      installmentPrice: null,
      installment: null,
      branchName: null,
      imeiSerial: null,
      link: null,
    });
    expect(text.split('\n')).toEqual(['-', 'ราคาเงินสด สอบถามแอดมิน']);
  });

  it('IMEI สั้นกว่า 4 ตัว ไม่ทำให้บรรทัดท้ายเพี้ยน', () => {
    const text = buildCustomerSummary({ brand: 'Apple', model: 'iPhone 13', imeiSerial: '12' });
    expect(text).not.toContain('เลขเครื่อง');
  });

  it('สีที่ไม่อยู่ใน IPHONE_COLORS mapping → ใช้ค่าดิบ ไม่มีคำว่า "สี" นำ (ตรงกับหน้าร้านจริง)', () => {
    const text = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 15',
      color: 'Midnight Green', // ค่า custom ที่พนักงานพิมพ์เอง ไม่อยู่ใน IPHONE_COLORS
      cashPrice: 25900,
    });
    expect(text).toContain('Apple iPhone 15 Midnight Green');
    expect(text).not.toContain('สีMidnight Green');
  });

  it('บรรทัดผ่อนมีค่า NaN/Infinity (installment object ที่ส่งมาตรงๆ เสีย) → ตัดทั้งบรรทัด ไม่โชว์ "NaN.undefined"', () => {
    const textNaN = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 13',
      cashPrice: 19900,
      installmentPrice: 19900,
      installment: { months: 12, downAmount: NaN, monthlyPayment: 2413.21 },
    });
    expect(textNaN).not.toContain('ผ่อน');
    expect(textNaN).not.toContain('NaN');

    const textInfinity = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 13',
      cashPrice: 19900,
      installmentPrice: 19900,
      installment: { months: 12, downAmount: 2985, monthlyPayment: Infinity },
    });
    expect(textInfinity).not.toContain('ผ่อน');
    expect(textInfinity).not.toContain('Infinity');
  });

  it('computeDefaultBcInstallment คืน null เมื่อ config เสีย → บรรทัดผ่อนตัดทั้งบรรทัดเหมือนกัน', () => {
    const badConfig = { ...config, minDownPct: NaN, vatPct: NaN };
    const installment = computeDefaultBcInstallment(19900, badConfig);
    expect(installment).toBeNull();

    const text = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 13',
      cashPrice: 19900,
      installmentPrice: 19900,
      installment,
    });
    expect(text).not.toContain('ผ่อน');
  });

  it('สมาชิก accessoriesIncluded ที่ว่าง/มีช่องว่างรอบ → trim + กรองทิ้งก่อน join', () => {
    const text = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 13',
      cashPrice: 15900,
      accessoriesIncluded: ['', '  กล่อง  ', 'สายชาร์จ', '   '],
    });
    expect(text).toContain('อุปกรณ์: กล่อง, สายชาร์จ');
  });

  it('accessoriesIncluded เป็นค่าว่างล้วน → ไม่มีบรรทัดอุปกรณ์เกิดขึ้นเลย', () => {
    const text = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 13',
      cashPrice: 15900,
      accessoriesIncluded: ['', '   '],
    });
    expect(text).not.toContain('อุปกรณ์');
  });

  it('batteryHealth เป็น 0 → ไม่โชว์ "แบต 0%"', () => {
    const text = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 13',
      cashPrice: 15900,
      batteryHealth: 0,
    });
    expect(text).not.toContain('แบต');
  });
});

describe('buildShopProductUrl', () => {
  it('ต่อ path จาก base ที่ส่งเข้ามา', () => {
    expect(buildShopProductUrl('p-1', 'https://www.bestchoicephone.com')).toBe(
      'https://www.bestchoicephone.com/products/p-1',
    );
  });

  it('ตัด / ท้าย base ซ้ำซ้อนออก', () => {
    expect(buildShopProductUrl('p-1', 'https://www.bestchoicephone.com/')).toBe(
      'https://www.bestchoicephone.com/products/p-1',
    );
  });
});
