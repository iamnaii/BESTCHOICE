import {
  normalizeStorage,
  extractStorageToken,
  stripStorageToken,
  parseDeviceQuery,
} from './device-query-normalize.util';

describe('normalizeStorage', () => {
  it('upper-case + ตัดช่องว่าง (parity กับ get-installment-rates.tool)', () => {
    expect(normalizeStorage('128 gb')).toBe('128GB');
    expect(normalizeStorage('1Tb')).toBe('1TB');
  });
  it('null/undefined/ว่าง → สตริงว่าง (ตรงกับ PricingTemplate.storage default "")', () => {
    expect(normalizeStorage(null)).toBe('');
    expect(normalizeStorage(undefined)).toBe('');
    expect(normalizeStorage('   ')).toBe('');
  });
});

describe('extractStorageToken', () => {
  it('ดึง token ความจุออกจากข้อความอิสระ', () => {
    expect(extractStorageToken('ไอโฟน 15 โปรแม็กซ์ 256 gb')).toBe('256GB');
    expect(extractStorageToken('ip15 1tb')).toBe('1TB');
  });
  it('ไม่มีความจุ → null', () => {
    expect(extractStorageToken('ไอโฟน 15')).toBeNull();
  });
  it('stripStorageToken ตัด token ออกและบีบช่องว่าง', () => {
    expect(stripStorageToken('iPhone 15 Pro Max 256GB')).toBe('iPhone 15 Pro Max');
  });
});

describe('parseDeviceQuery', () => {
  it('ไอโฟน → Apple + รุ่นตัวเลข', () => {
    const q = parseDeviceQuery('ไอโฟน 15');
    expect(q.brand).toBe('Apple');
    expect(q.model).toBe('iPhone 15');
  });
  it('รองรับ ip15 / 15pm ย่อ', () => {
    expect(parseDeviceQuery('ip15').model).toBe('iPhone 15');
    expect(parseDeviceQuery('15pm').model).toBe('iPhone 15 Pro Max');
  });
  it('โปรแม็กซ์ / พลัส / โปร ภาษาไทย', () => {
    expect(parseDeviceQuery('ไอโฟน 15 โปรแม็กซ์').model).toBe('iPhone 15 Pro Max');
    expect(parseDeviceQuery('ไอโฟน 14 พลัส').model).toBe('iPhone 14 Plus');
    expect(parseDeviceQuery('ไอโฟน 13 โปร').model).toBe('iPhone 13 Pro');
  });
  // ปักหมุดลำดับ VARIANTS: บล็อก Plus ต้องมาก่อน Pro เพราะ Pro มี token 'p'
  // และ ' plus'.includes('p') === true → ถ้า Pro มาก่อน '15 plus' จะได้ 'iPhone 15 Pro'
  // (ชุดเดิมทดสอบแค่ 'พลัส' ภาษาไทย จึงไม่จับบั๊กนี้)
  it('plus ภาษาอังกฤษ ต้องไม่ถูกกลืนเป็น Pro (token "p" ชนกับ "plus")', () => {
    expect(parseDeviceQuery('15 plus').model).toBe('iPhone 15 Plus');
    expect(parseDeviceQuery('ไอโฟน 14 plus').model).toBe('iPhone 14 Plus');
  });
  it('ดึงความจุ + สีไทยออกมาแยก', () => {
    const q = parseDeviceQuery('ไอโฟน 15 โปร 256gb สีดำ');
    expect(q.model).toBe('iPhone 15 Pro');
    expect(q.storage).toBe('256GB');
    expect(q.color).toBe('ดำ');
  });
  it('เลขรุ่นเปล่า + สี ("15pm สีดำ") → ยังจับเป็น iPhone ได้', () => {
    const q = parseDeviceQuery('15pm สีดำ');
    expect(q.brand).toBe('Apple');
    expect(q.model).toBe('iPhone 15 Pro Max');
    expect(q.color).toBe('ดำ');
  });
  it('น้ำเงิน ต้องไม่ถูกจับเป็น "เงิน"', () => {
    expect(parseDeviceQuery('ไอโฟน 15 สีน้ำเงิน').color).toBe('น้ำเงิน');
  });
  it('ข้อความที่ไม่ใช่มือถือ / มีตัวเลขปนแต่ไม่ใช่รุ่น → brand/model เป็น null แต่ไม่ throw', () => {
    expect(parseDeviceQuery('สวัสดีครับ').brand).toBeNull();
    expect(parseDeviceQuery('สวัสดีครับ').model).toBeNull();
    // BARE_MODEL_RE ต้อง anchor ทั้งข้อความ ไม่งั้น 'ผ่อน 12 งวด' จะกลายเป็น iPhone 12
    expect(parseDeviceQuery('ผ่อน 12 งวด').model).toBeNull();
  });
});
