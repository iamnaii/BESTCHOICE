import { BadRequestException } from '@nestjs/common';
import {
  normalizeDocNumber,
  normalizeSupplierDoc,
  parseSupplierDocDate,
  supplierDocMetadata,
  supplierDocRef,
} from './supplier-doc.util';

/** ข3 — ช่องเอกสารผู้จัดจำหน่ายบนใบรับของ (flow จริงบนฐานข้อมูลอยู่ที่ `__tests__/po-receiving-journal.integration.spec.ts`) */
describe('supplier-doc.util', () => {
  // 1 ต.ค. 2569 10:00 น. เวลาไทย
  const now = new Date('2026-10-01T03:00:00.000Z');

  it('วันที่ในเอกสารเก็บเป็นเที่ยงคืนเวลาไทย ไม่ขึ้นกับเขตเวลาของโปรเซส · วันที่ไม่มีจริง = 400', () => {
    expect(parseSupplierDocDate('2026-09-15').toISOString()).toBe('2026-09-14T17:00:00.000Z');
    expect(parseSupplierDocDate('2026-10-01').toISOString()).toBe('2026-09-30T17:00:00.000Z');
    for (const bad of ['2026-02-30', '2026-13-01', '15/09/2569', '2026-9-15']) {
      expect(() => parseSupplierDocDate(bad)).toThrow('วันที่ในเอกสารไม่ถูกต้อง');
    }
  });

  it('เลขที่: ตัดช่องว่างหัวท้าย ยุบช่องว่างซ้อน', () => {
    expect(normalizeDocNumber('  IV 2609   0877 ')).toBe('IV 2609 0877');
    expect(normalizeDocNumber(undefined)).toBe('');
  });

  it('มีเอกสาร: เลขที่ + วันที่บังคับ · วันนี้ได้ พรุ่งนี้ไม่ได้ (ปฏิทินไทย)', () => {
    expect(normalizeSupplierDoc({ supplierDocType: 'TAX_INVOICE', supplierDocNumber: ' IV-1 ', supplierDocDate: '2026-10-01' }, now)).toEqual({
      type: 'TAX_INVOICE',
      number: 'IV-1',
      date: new Date('2026-09-30T17:00:00.000Z'),
    });
    expect(() => normalizeSupplierDoc({ supplierDocType: 'TAX_INVOICE', supplierDocDate: '2026-10-01' }, now)).toThrow('กรุณากรอกเลขที่เอกสาร');
    expect(() => normalizeSupplierDoc({ supplierDocType: 'CASH_BILL', supplierDocNumber: 'CB-1' }, now)).toThrow('กรุณาเลือกวันที่ในเอกสาร');
    expect(() =>
      normalizeSupplierDoc({ supplierDocType: 'DELIVERY_NOTE', supplierDocNumber: 'DN-1', supplierDocDate: '2026-10-02' }, now),
    ).toThrow('วันที่ในเอกสารต้องไม่เกินวันนี้ (01/10/2569)');
    expect(() =>
      normalizeSupplierDoc({ supplierDocType: 'DELIVERY_NOTE', supplierDocNumber: 'x'.repeat(65), supplierDocDate: '2026-10-01' }, now),
    ).toThrow(BadRequestException);
  });

  it('ย้อนหลังได้ไม่เกิน 365 วัน — กันปีพิมพ์ผิดไปลงเดือนที่ไม่เคยปิดงวด', () => {
    const doc = (date: string) => ({ supplierDocType: 'TAX_INVOICE' as const, supplierDocNumber: 'IV-1', supplierDocDate: date });
    expect(normalizeSupplierDoc(doc('2025-10-01'), now).date?.toISOString()).toBe('2025-09-30T17:00:00.000Z');
    expect(() => normalizeSupplierDoc(doc('2025-09-30'), now)).toThrow('วันที่ในเอกสารเก่าเกิน 365 วัน (ก่อน 01/10/2568)');
    expect(() => normalizeSupplierDoc(doc('0202-09-30'), now)).toThrow('วันที่ในเอกสารเก่าเกิน 365 วัน');
  });

  it('ไม่มีเอกสาร: ต้องมีเหตุผลในหมายเหตุ · ไม่เก็บเลขที่/วันที่แม้ส่งมา', () => {
    expect(() => normalizeSupplierDoc({ supplierDocType: 'NONE', notes: '  ' }, now)).toThrow('กรุณาเขียนเหตุผลที่ไม่มีเอกสาร');
    expect(normalizeSupplierDoc({ supplierDocType: 'NONE', supplierDocNumber: 'X', supplierDocDate: '2026-09-01', notes: 'ร้านไม่ออกบิล' }, now)).toEqual({
      type: 'NONE',
      number: null,
      date: null,
    });
  });

  it('ผู้เรียกภายในที่ไม่ส่งประเภท = ไม่มีข้อมูลเอกสาร (ลงวันที่รับของแบบเดิม)', () => {
    expect(normalizeSupplierDoc({ notes: 'x' }, now)).toEqual({ type: null, number: null, date: null });
    expect(() => normalizeSupplierDoc({ supplierDocType: 'BOGUS' as never }, now)).toThrow('ประเภทเอกสารของผู้จัดจำหน่ายไม่ถูกต้อง');
  });

  it('ข้อความอ้างอิง + metadata ของรายการบัญชี', () => {
    const doc = { type: 'TAX_INVOICE' as const, number: 'IV-1', date: new Date('2026-09-14T17:00:00.000Z') };
    expect(supplierDocRef(doc)).toBe('ใบกำกับภาษี IV-1');
    expect(supplierDocMetadata(doc)).toEqual({ supplierDocType: 'TAX_INVOICE', supplierDocNumber: 'IV-1', supplierDocDate: '2026-09-15' });
    expect(supplierDocRef({ type: 'NONE', number: null })).toBeNull();
    expect(supplierDocMetadata({ type: null, number: null, date: null })).toEqual({});
  });
});
