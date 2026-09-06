import { BadRequestException } from '@nestjs/common';
import {
  TEST_ALERT_MODEL,
  TEST_CUSTOMER_ADDRESS,
  TEST_DOC_PREFIX,
  TEST_NAME_PREFIX,
  TEST_NOTE_MARKER,
  TEST_STOCK_COUNT_PREFIX,
  assertSameTestSide,
  isTestAlertModel,
  isTestCustomer,
  isTestNote,
  isTestProduct,
  isTestPurchaseOrder,
  isTestStockCount,
  isTestSupplier,
} from './test-data-markers';

const realCustomer = { name: 'สมชาย ใจดี', phone: '0891234567', addressCurrent: 'กรุงเทพ' };
const testCustomer = {
  name: 'ทดสอบระบบ ลูกค้า 1',
  phone: 'TEST-0000001',
  addressCurrent: TEST_CUSTOMER_ADDRESS,
};
const realProduct = { imeiSerial: '356789012345678', name: 'iPhone 15 128GB', po: null };
const testProduct = { imeiSerial: 'TEST-0001', name: 'ทดสอบระบบ มือถือ', po: null };

describe('test-data-markers — ค่าคงที่ต้องไม่เปลี่ยน (cleanup เดิมกวาดด้วยค่าเหล่านี้)', () => {
  it('pins marker values', () => {
    expect(TEST_DOC_PREFIX).toBe('TEST-');
    expect(TEST_NAME_PREFIX).toBe('ทดสอบระบบ');
    expect(TEST_NOTE_MARKER).toBe('[ทดสอบระบบ]');
    expect(TEST_CUSTOMER_ADDRESS).toBe('ข้อมูลทดสอบระบบ — ลบได้');
    expect(TEST_STOCK_COUNT_PREFIX).toBe('TEST-COUNT-');
    expect(TEST_ALERT_MODEL).toBe('TEST-รุ่นแจ้งเตือน');
  });
});

describe('isTestProduct', () => {
  it('IMEI ขึ้นต้น TEST-', () => {
    expect(isTestProduct({ imeiSerial: 'TEST-001', name: 'iPhone', po: null })).toBe(true);
  });
  it('ชื่อขึ้นต้น ทดสอบระบบ', () => {
    expect(isTestProduct({ imeiSerial: '3567', name: 'ทดสอบระบบ มือถือ', po: null })).toBe(true);
  });
  it('อุปกรณ์เสริมไร้ IMEI จาก PO ทดสอบ', () => {
    expect(
      isTestProduct({ imeiSerial: null, name: 'สายชาร์จ', po: { poNumber: 'TEST-PO-0001' } }),
    ).toBe(true);
  });
  it('ของจริง: IMEI จริง ชื่อจริง PO จริง', () => {
    expect(
      isTestProduct({ imeiSerial: '3567', name: 'iPhone', po: { poNumber: 'PO-20260905-0001' } }),
    ).toBe(false);
  });
  it('ของจริงไร้ IMEI ไม่มี PO', () => {
    expect(isTestProduct({ imeiSerial: null, name: 'เคสใส', po: null })).toBe(false);
  });
  it('คำว่า ทดสอบระบบ กลางชื่อ ไม่นับ (prefix เท่านั้น)', () => {
    expect(isTestProduct({ imeiSerial: null, name: 'เครื่อง ทดสอบระบบ', po: null })).toBe(false);
  });
});

describe('isTestCustomer', () => {
  it('ที่อยู่ปัจจุบัน = marker', () => {
    expect(isTestCustomer({ ...realCustomer, addressCurrent: TEST_CUSTOMER_ADDRESS })).toBe(true);
  });
  it('เบอร์ขึ้นต้น TEST-', () => {
    expect(isTestCustomer({ ...realCustomer, phone: 'TEST-0000009' })).toBe(true);
  });
  it('ลูกค้าจริง', () => {
    expect(isTestCustomer(realCustomer)).toBe(false);
  });
  it('ที่อยู่ null = จริง', () => {
    expect(isTestCustomer({ ...realCustomer, addressCurrent: null })).toBe(false);
  });
});

describe('predicate ตารางอื่น', () => {
  it('supplier ตามชื่อ', () => {
    expect(isTestSupplier({ name: 'ทดสอบระบบ ซัพพลายเออร์' })).toBe(true);
    expect(isTestSupplier({ name: 'บริษัท ซัพพลาย จำกัด' })).toBe(false);
  });
  it('PO ตามเลข', () => {
    expect(isTestPurchaseOrder({ poNumber: 'TEST-PO-0001' })).toBe(true);
    expect(isTestPurchaseOrder({ poNumber: 'PO-20260905-0001' })).toBe(false);
  });
  it('notes ตาม marker — null = จริง', () => {
    expect(isTestNote('[ทดสอบระบบ] โอน')).toBe(true);
    expect(isTestNote('โอนไปสาขา 2')).toBe(false);
    expect(isTestNote(null)).toBe(false);
    expect(isTestNote(undefined)).toBe(false);
  });
  it('stock count ตามเลข', () => {
    expect(isTestStockCount({ countNumber: 'TEST-COUNT-0001' })).toBe(true);
    expect(isTestStockCount({ countNumber: 'SC-2026-09-001' })).toBe(false);
  });
  it('alert model = ค่าตรงตัว ไม่ใช่ prefix', () => {
    expect(isTestAlertModel('TEST-รุ่นแจ้งเตือน')).toBe(true);
    expect(isTestAlertModel('TEST-รุ่นแจ้งเตือน 2')).toBe(false);
  });
});

describe('assertSameTestSide', () => {
  it('จริง ↔ จริง ผ่าน', () => {
    expect(() => assertSameTestSide(realCustomer, realProduct)).not.toThrow();
  });
  it('ทดสอบ ↔ ทดสอบ ผ่าน', () => {
    expect(() => assertSameTestSide(testCustomer, testProduct)).not.toThrow();
  });
  it('เครื่องทดสอบ → ลูกค้าจริง: BadRequest ระบุ IMEI + ที่อยู่ marker', () => {
    expect(() => assertSameTestSide(realCustomer, testProduct)).toThrow(BadRequestException);
    try {
      assertSameTestSide(realCustomer, testProduct);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('TEST-0001');
      expect(msg).toContain('เครื่องทดสอบระบบ');
      expect(msg).toContain(TEST_CUSTOMER_ADDRESS);
    }
  });
  it('เครื่องจริง → ลูกค้าทดสอบ: BadRequest ระบุชื่อลูกค้า + IMEI', () => {
    expect(() => assertSameTestSide(testCustomer, realProduct)).toThrow(BadRequestException);
    try {
      assertSameTestSide(testCustomer, realProduct);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('ทดสอบระบบ ลูกค้า 1');
      expect(msg).toContain('356789012345678');
      expect(msg).toContain('ลูกค้าทดสอบระบบ');
    }
  });
  it('เครื่องไร้ IMEI ใช้ชื่อในข้อความ', () => {
    try {
      assertSameTestSide(realCustomer, {
        imeiSerial: null,
        name: 'สายชาร์จ',
        po: { poNumber: 'TEST-PO-0001' },
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('สายชาร์จ');
    }
  });
});
