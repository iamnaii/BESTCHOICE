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
});

describe('buildCustomerSummary', () => {
  it('ประกอบข้อความครบทุกส่วนเมื่อข้อมูลครบ', () => {
    const text = buildCustomerSummary({
      brand: 'Apple',
      model: 'iPhone 13',
      storage: '128GB',
      color: 'ดำ',
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
