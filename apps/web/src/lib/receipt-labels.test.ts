import { describe, expect, it } from 'vitest';
import { methodLabels } from '@/pages/PaymentsPage/types';
import {
  LIFF_RECEIPT_TYPE_LABELS,
  RECEIPT_METHOD_LABELS,
  RECEIPT_TYPE_LABELS,
} from './receipt-labels';

describe('ป้ายรายการใบเสร็จ (PR3)', () => {
  it('ใบค่างวดที่ระบบออก (INSTALLMENT) แสดงเป็น "งวดผ่อนชำระ" ไม่ใช่รหัสดิบ', () => {
    expect(RECEIPT_TYPE_LABELS.INSTALLMENT).toBe('งวดผ่อนชำระ');
    expect(RECEIPT_TYPE_LABELS.PAYMENT).toBe('งวดผ่อนชำระ');
  });

  it('ช่องทางของใบเสร็จที่เริ่มออกใน PR3 มีป้ายภาษาไทย — ข้อความเดียวกับใบเสร็จ PDF', () => {
    expect(RECEIPT_METHOD_LABELS.ONLINE_GATEWAY).toBe('ชำระออนไลน์');
    expect(RECEIPT_METHOD_LABELS.CREDIT_BALANCE).toBe('ใช้ยอดเครดิตในสัญญา');
    expect(RECEIPT_METHOD_LABELS.CARD).toBe('บัตร (EDC)');
  });

  it('สรุปรายวันของหน้ารับชำระใช้ป้ายช่องทางชุดเดียวกัน — ใบใช้เครดิต / ลิงก์ชำระ / บัตร ไม่เป็นรหัสดิบ', () => {
    expect(methodLabels).toBe(RECEIPT_METHOD_LABELS);
    expect(methodLabels.CREDIT_BALANCE).toBe('ใช้ยอดเครดิตในสัญญา');
    expect(methodLabels.ONLINE_GATEWAY).toBe('ชำระออนไลน์');
  });

  it('รายการใบเสร็จของลูกค้าในไลน์ (LIFF): ใบค่างวดที่ระบบออก (INSTALLMENT) แสดงเป็น "ค่างวด"', () => {
    expect(LIFF_RECEIPT_TYPE_LABELS.INSTALLMENT).toEqual({ label: 'ค่างวด', variant: 'success' });
    expect(LIFF_RECEIPT_TYPE_LABELS.PAYMENT.label).toBe('ค่างวด');
  });
});
