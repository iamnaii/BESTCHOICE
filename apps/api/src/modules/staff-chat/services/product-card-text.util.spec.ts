import { buildProductCardText, fmtBaht } from './product-card-text.util';

const USED: Parameters<typeof buildProductCardText>[0] = {
  name: 'iPhone 13 128GB',
  brand: 'Apple',
  model: 'iPhone 13',
  color: 'สีชมพู',
  storage: '128GB',
  category: 'PHONE_USED',
  status: 'IN_STOCK',
  conditionGrade: 'A',
  batteryHealth: 92,
  shopWarrantyDays: 30,
  branchName: 'ลาดพร้าว',
};

describe('buildProductCardText', () => {
  it('ประกอบครบทุกบรรทัดจากข้อมูลจริง + ลิงก์', () => {
    const text = buildProductCardText(
      USED,
      { cashPrice: 19500, installmentPrice: 20000, months: 12, monthlyPayment: 1926, downAmount: 4000 },
      'https://www.bestchoicephone.com/products/p1',
    );
    expect(text).toContain('Apple iPhone 13 128GB สีชมพู');
    expect(text).toContain('เงินสด 19,500 บาท');
    expect(text).toContain('ผ่อน 12 งวด งวดละ 1,926 บาท (ดาวน์ 4,000 บาท)');
    expect(text).toContain('สภาพ A');
    expect(text).toContain('แบตเตอรี่ 92%');
    expect(text).toContain('ประกันร้าน 30 วัน');
    expect(text).toContain('สาขาลาดพร้าว');
    expect(text).toContain('พร้อมขาย');
    expect(text).toContain('https://www.bestchoicephone.com/products/p1');
  });

  it('ไม่มีราคาผ่อน → ไม่มีบรรทัดผ่อน และห้ามมีข้อความ 12 งวดตายตัว', () => {
    const text = buildProductCardText(
      { ...USED, category: 'PHONE_NEW', conditionGrade: null, batteryHealth: null },
      { cashPrice: 32900, installmentPrice: null, months: null, monthlyPayment: null, downAmount: null },
      null,
    );
    expect(text).not.toContain('ผ่อน');
    expect(text).not.toContain('12 งวด');
    expect(text).not.toContain('สภาพ');
    expect(text).not.toContain('แบตเตอรี่');
    expect(text).toContain('เงินสด 32,900 บาท');
  });

  it('ไม่มีราคาเลย → บอกให้สอบถามแอดมิน (ห้ามโชว์ 0 บาท)', () => {
    const text = buildProductCardText(
      USED,
      { cashPrice: null, installmentPrice: null, months: null, monthlyPayment: null, downAmount: null },
      null,
    );
    expect(text).toContain('สอบถามราคากับแอดมิน');
    expect(text).not.toContain('0 บาท');
  });

  it('เครื่องติดจอง → บอกสถานะตรงๆ', () => {
    const text = buildProductCardText(
      { ...USED, status: 'RESERVED' },
      { cashPrice: 19500, installmentPrice: null, months: null, monthlyPayment: null, downAmount: null },
      null,
    );
    expect(text).toContain('ติดจองชั่วคราว');
  });
});

describe('fmtBaht', () => {
  it('คั่นหลักพันและตัดทศนิยมที่ไม่จำเป็น', () => {
    expect(fmtBaht(1926)).toBe('1,926');
    expect(fmtBaht(2225.6)).toBe('2,225.6');
  });
});
