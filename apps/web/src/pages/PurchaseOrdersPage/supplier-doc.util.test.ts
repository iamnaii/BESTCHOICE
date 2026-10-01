import { describe, it, expect } from 'vitest';
import { formatDateShort } from '@/utils/formatters';
import {
  bangkokTodayIso,
  defaultSupplierDoc,
  formatIsoDate,
  formatIsoMonth,
  postingDateLine,
  supplierDocErrors,
  supplierDocPayload,
  supplierDocSummary,
} from './supplier-doc.util';

// ข3 — ช่องเอกสารผู้จัดจำหน่าย (กติกาเดียวกับ API normalizeSupplierDoc)
describe('supplier-doc.util', () => {
  it('ค่าเริ่มต้นตามสถานะ VAT ของผู้จัดจำหน่าย (ข้อ 4)', () => {
    expect(defaultSupplierDoc(true).type).toBe('TAX_INVOICE');
    expect(defaultSupplierDoc(false).type).toBe('DELIVERY_NOTE');
  });

  it('วันนี้ตามปฏิทินไทย — 23:30 น. UTC = วันถัดไปของไทย', () => {
    expect(bangkokTodayIso(new Date('2026-09-30T23:30:00Z'))).toBe('2026-10-01');
    expect(bangkokTodayIso(new Date('2026-09-30T16:59:00Z'))).toBe('2026-09-30');
  });

  it('จัดรูปวันที่ YYYY-MM-DD โดยไม่ขยับวันตามเขตเวลาของเครื่อง', () => {
    expect(formatIsoDate('2026-09-28')).toBe('28/09/2569');
    expect(formatIsoMonth('2026-08-15')).toBe('สิงหาคม 2569');
  });

  it('ตรวจก่อนยืนยัน: เลขที่/วันที่บังคับ · วันที่ห้ามเกินวันนี้ · ไม่มีเอกสารต้องมีเหตุผล', () => {
    expect(supplierDocErrors({ type: 'TAX_INVOICE', number: ' ', date: '' }, '', '2026-10-01')).toEqual({
      number: 'กรุณากรอกเลขที่เอกสาร',
      date: 'กรุณาเลือกวันที่ในเอกสาร',
    });
    expect(supplierDocErrors({ type: 'CASH_BILL', number: 'CB-1', date: '2026-10-02' }, '', '2026-10-01')).toEqual({
      date: 'วันที่ในเอกสารต้องไม่เกินวันนี้ (01/10/2569)',
    });
    expect(supplierDocErrors({ type: 'CASH_BILL', number: 'CB-1', date: '2026-10-01' }, '', '2026-10-01')).toEqual({});
    expect(supplierDocErrors({ type: 'NONE', number: '', date: '' }, '  ', '2026-10-01')).toEqual({
      notes: 'กรุณาเขียนเหตุผลที่ไม่มีเอกสาร เช่น ร้านไม่ออกบิล',
    });
    expect(supplierDocErrors({ type: 'NONE', number: '', date: '' }, 'ร้านไม่ออกบิล', '2026-10-01')).toEqual({});
  });

  it('ส่ง API: ตัดช่องว่างเลขที่ · ไม่มีเอกสาร = ส่งแค่ประเภท', () => {
    expect(supplierDocPayload({ type: 'TAX_INVOICE', number: ' IV-1 ', date: '2026-09-28' })).toEqual({
      supplierDocType: 'TAX_INVOICE',
      supplierDocNumber: 'IV-1',
      supplierDocDate: '2026-09-28',
    });
    expect(supplierDocPayload({ type: 'NONE', number: 'X', date: '2026-09-28' })).toEqual({ supplierDocType: 'NONE' });
  });

  it('บรรทัด "ลงบัญชีวันที่" ในกล่องสรุป', () => {
    const doc = { type: 'TAX_INVOICE' as const, number: 'IV-1', date: '2026-09-28' };
    expect(postingDateLine(doc, false, '2026-10-01')).toBe('28/09/2569 (ตามเอกสาร)');
    expect(postingDateLine(doc, true, '2026-10-01')).toBe('01/10/2569 (วันที่รับของ)');
    expect(postingDateLine({ ...doc, type: 'NONE' }, false, '2026-10-01')).toBe('01/10/2569 (วันที่รับของ)');
    expect(postingDateLine({ ...doc, date: '' }, false, '2026-10-01')).toBeNull();
  });

  it('บรรทัดในประวัติ / หน้าพิมพ์', () => {
    const stored = '2026-09-27T17:00:00.000Z'; // เที่ยงคืนเวลาไทย 28 ก.ย.
    expect(supplierDocSummary({ supplierDocType: 'TAX_INVOICE', supplierDocNumber: 'IV2610-0123', supplierDocDate: stored })).toBe(
      `ใบกำกับภาษี IV2610-0123 · ลงวันที่ ${formatDateShort(stored)}`,
    );
    expect(supplierDocSummary({ supplierDocType: 'NONE', supplierDocNumber: null, supplierDocDate: null })).toBe('ไม่มีเอกสาร');
    expect(supplierDocSummary({ supplierDocType: null })).toBeNull();
  });
});
