/**
 * ก้อน 2 จ่ายเงินผู้จัดจำหน่าย — ฟังก์ชันบริสุทธิ์: ฐานะมัดจำ/เจ้าหนี้ของใบสั่งซื้อจากสมุดบัญชี, การปันยอดชำระ, วันที่โอน
 */
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  allocatePayable,
  parsePaidAt,
  splitSettlement,
  supplierPaymentPosition,
  SUPPLIER_PAYMENT_MAX_AGE_DAYS,
} from './supplier-payment.util';

const d = (v: string | number) => new Decimal(v);
const line = (accountCode: string, debit: string | number, credit: string | number) => ({ accountCode, debit: d(debit), credit: d(credit) });
const row = (kind: 'DEPOSIT' | 'SETTLEMENT' | 'DEPOSIT_APPLIED' | 'DEPOSIT_REFUND' | 'DEPOSIT_FORFEIT', amount: string | number, voidedAt: Date | null = null) =>
  ({ kind, amount: d(amount), voidedAt });
const show = (map: Record<string, Decimal>) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.toFixed(2)]));

describe('supplierPaymentPosition — ฐานะจากสมุดบัญชี + แถวการจ่าย', () => {
  it('ยังไม่มีอะไรเลย → ศูนย์ทุกช่อง สถานะยังไม่จ่าย', () => {
    const p = supplierPaymentPosition(d('15729'), [], []);
    expect(p.depositOutstanding.toFixed(2)).toBe('0.00');
    expect(p.payableOutstanding.toFixed(2)).toBe('0.00');
    expect(p.paidTotal.toFixed(2)).toBe('0.00');
    expect(p.remainingOnPo.toFixed(2)).toBe('15729.00');
    expect(p.hasBookedPayable).toBe(false);
    expect(p.status).toBe('UNPAID');
  });

  it('มัดจำอย่างเดียว (ยังไม่รับของ) → มัดจำค้าง = ยอดมัดจำ สถานะจ่ายมัดจำ', () => {
    const p = supplierPaymentPosition(d('15729'), [row('DEPOSIT', 5000)], [line('S11-4201', 5000, 0), line('S11-1202', 0, 5000)]);
    expect(p.depositOutstanding.toFixed(2)).toBe('5000.00');
    expect(p.payableOutstanding.toFixed(2)).toBe('0.00');
    expect(p.paidTotal.toFixed(2)).toBe('5000.00');
    expect(p.status).toBe('DEPOSIT_PAID');
  });

  it('มัดจำ + รับของ + หักมัดจำเข้าเจ้าหนี้ → เจ้าหนี้คงเหลือลดลง มัดจำค้างศูนย์ หักมัดจำไม่นับเป็นเงินที่จ่าย', () => {
    const p = supplierPaymentPosition(
      d('15729'),
      [row('DEPOSIT', 5000), row('DEPOSIT_APPLIED', 5000)],
      [
        line('S11-4201', 5000, 0), line('S11-1202', 0, 5000),
        line('S11-2001', 15729, 0), line('S21-1101', 0, 15729),
        line('S21-1101', 5000, 0), line('S11-4201', 0, 5000),
      ],
    );
    expect(p.depositOutstanding.toFixed(2)).toBe('0.00');
    expect(show(p.payableByAccount)).toEqual({ 'S21-1101': '10729.00' });
    expect(p.payableOutstanding.toFixed(2)).toBe('10729.00');
    expect(p.paidTotal.toFixed(2)).toBe('5000.00');
    expect(p.hasBookedPayable).toBe(true);
    expect(p.status).toBe('PARTIALLY_PAID');
  });

  it('แถวที่ยกเลิกแล้ว (void) ไม่นับ และบรรทัดกลับรายการหักล้างกัน', () => {
    const p = supplierPaymentPosition(
      d('15729'),
      [row('DEPOSIT', 5000, new Date())],
      [line('S11-4201', 5000, 0), line('S11-1202', 0, 5000), line('S11-4201', 0, 5000), line('S11-1202', 5000, 0)],
    );
    expect(p.depositOutstanding.toFixed(2)).toBe('0.00');
    expect(p.paidTotal.toFixed(2)).toBe('0.00');
    expect(p.status).toBe('UNPAID');
  });

  it('ได้เงินมัดจำคืน → เงินที่จ่ายลดลง · ริบมัดจำไม่ลด (เงินออกไปแล้ว)', () => {
    const refunded = supplierPaymentPosition(
      d('10000'),
      [row('DEPOSIT', 3000), row('DEPOSIT_REFUND', 2500), row('DEPOSIT_FORFEIT', 500)],
      [
        line('S11-4201', 3000, 0), line('S11-1202', 0, 3000),
        line('S11-1201', 2500, 0), line('S11-4201', 0, 2500),
        line('S53-1105', 500, 0), line('S11-4201', 0, 500),
      ],
    );
    expect(refunded.depositOutstanding.toFixed(2)).toBe('0.00');
    expect(refunded.paidTotal.toFixed(2)).toBe('500.00');
  });

  it('จ่ายครบยอดสุทธิ (แม้ยังไม่รับของ) → จ่ายครบแล้ว · เจ้าหนี้ 2 บัญชีแยกกัน', () => {
    const full = supplierPaymentPosition(d('5000'), [row('DEPOSIT', 5000)], [line('S11-4201', 5000, 0), line('S11-1202', 0, 5000)]);
    expect(full.status).toBe('FULLY_PAID');
    expect(full.remainingOnPo.toFixed(2)).toBe('0.00');
    const two = supplierPaymentPosition(d('12729'), [], [line('S21-1101', 0, 10000), line('S21-1102', 0, 2729), line('S21-1102', 729, 0)]);
    expect(show(two.payableByAccount)).toEqual({ 'S21-1101': '10000.00', 'S21-1102': '2000.00' });
    expect(two.payableOutstanding.toFixed(2)).toBe('12000.00');
  });
});

describe('splitSettlement / allocatePayable — ปันยอดตามเจ้าหนี้', () => {
  it('ปันเรียงรหัสบัญชี เต็มเจ้าหนี้ทีละบัญชี ส่วนเกิน = มัดจำ', () => {
    const exact = splitSettlement(d('10729'), { 'S21-1102': d('2729'), 'S21-1101': d('8000') });
    expect(exact.lines.map((l) => [l.accountCode, l.amount.toFixed(2)])).toEqual([['S21-1101', '8000.00'], ['S21-1102', '2729.00']]);
    expect(exact.settled.toFixed(2)).toBe('10729.00');
    expect(exact.excess.toFixed(2)).toBe('0.00');

    const over = splitSettlement(d('12000'), { 'S21-1101': d('10486') });
    expect(over.lines.map((l) => [l.accountCode, l.amount.toFixed(2)])).toEqual([['S21-1101', '10486.00']]);
    expect(over.settled.toFixed(2)).toBe('10486.00');
    expect(over.excess.toFixed(2)).toBe('1514.00');

    const none = splitSettlement(d('100'), {});
    expect(none.lines).toEqual([]);
    expect(none.excess.toFixed(2)).toBe('100.00');
  });

  it('allocatePayable: หักมัดจำเข้าเจ้าหนี้ที่เพิ่งเกิด ตามลำดับบรรทัด ไม่เกินยอดที่ให้', () => {
    const payable = [{ accountCode: 'S21-1101', amount: d('8000') }, { accountCode: 'S21-1102', amount: d('2729') }];
    expect(allocatePayable(d('5000'), payable).map((l) => [l.accountCode, l.amount.toFixed(2)])).toEqual([['S21-1101', '5000.00']]);
    expect(allocatePayable(d('9000'), payable).map((l) => [l.accountCode, l.amount.toFixed(2)])).toEqual([['S21-1101', '8000.00'], ['S21-1102', '1000.00']]);
    expect(allocatePayable(d('20000'), payable).map((l) => l.amount.toFixed(2))).toEqual(['8000.00', '2729.00']);
  });
});

describe('parsePaidAt — วันที่โอน', () => {
  const now = new Date('2026-10-05T03:00:00.000Z'); // 10:00 เวลาไทย
  it('วันนี้และย้อนหลังในกรอบ → เที่ยงคืนเวลาไทย', () => {
    expect(parsePaidAt('2026-10-05', now).toISOString()).toBe('2026-10-04T17:00:00.000Z');
    expect(parsePaidAt('2026-09-28', now).toISOString()).toBe('2026-09-27T17:00:00.000Z');
  });
  it('อนาคต · เก่าเกิน 365 วัน · รูปแบบผิด → 400', () => {
    expect(() => parsePaidAt('2026-10-06', now)).toThrow(BadRequestException);
    expect(() => parsePaidAt('2025-10-04', now)).toThrow(BadRequestException);
    expect(() => parsePaidAt('05/10/2569', now)).toThrow(BadRequestException);
    expect(SUPPLIER_PAYMENT_MAX_AGE_DAYS).toBe(365);
  });
});
