/**
 * ตัวช่วยล้วน ๆ ของเมนูเงินสดย่อยหน้าร้าน (ข้อ 20.2 · 2026-10-18): จัดชนิดบรรทัดบัญชี S11-1106 · ยอดคงเหลือสะสม ·
 * วงเงิน/เติมได้อีก · ช่วงเดือนไทย — ส่วนที่ต่อ DB อยู่ใน shop-petty-cash.integration.spec.ts (vitest)
 */
import { Decimal } from '@prisma/client/runtime/library';
import {
  classifyPettyCashLine,
  computeHeadroom,
  resolveLimit,
  thaiMonthRange,
  withRunningBalance,
  type PettyCashLedgerLine,
} from '../shop-petty-cash.util';

const line = (over: Partial<PettyCashLedgerLine>): PettyCashLedgerLine => ({
  id: 'l1',
  debit: new Decimal(0),
  credit: new Decimal(0),
  entry: { id: 'je1', entryNumber: 'S-JV-2569-0001', entryDate: new Date('2026-10-10T17:00:00.000Z'), description: 'x', metadata: null, createdById: 'u1' },
  ...over,
});

describe('classifyPettyCashLine', () => {
  it('เติม/คืนจากเมนูนี้ — อ่าน kind · ธนาคาร · movementId จาก metadata', () => {
    const topUp = classifyPettyCashLine(
      line({ debit: new Decimal('10000'), entry: { ...line({}).entry, metadata: { flow: 'shop-petty-cash', kind: 'TOP_UP', movementId: 'm1', bankAccountCode: 'S11-1202' } } }),
    );
    expect(topUp).toMatchObject({ kind: 'TOP_UP', label: 'เติมจาก ธนาคารหน้าร้าน (จ่ายออก)', bankAccountCode: 'S11-1202', movementId: 'm1' });
    const ret = classifyPettyCashLine(
      line({ credit: new Decimal('500'), entry: { ...line({}).entry, metadata: { flow: 'shop-petty-cash', kind: 'RETURN', movementId: 'm2', bankAccountCode: 'S11-1201' } } }),
    );
    expect(ret).toMatchObject({ kind: 'RETURN', label: 'คืนเข้า ธนาคารหน้าร้าน (รับเข้า)', bankAccountCode: 'S11-1201', movementId: 'm2' });
  });

  it('จ่ายผู้จัดจำหน่าย — ชื่อร้าน + เลขใบสั่งซื้อ + ชนิด · กลับรายการแยกชนิด', () => {
    const paid = classifyPettyCashLine(
      line({
        credit: new Decimal('486'),
        entry: { ...line({}).entry, metadata: { flow: 'shop-supplier-payment', tag: 'SHOP_SUPPLIER_PAYMENT', kind: 'SETTLEMENT', poId: 'po1', poNumber: 'PO-20261018-0007', supplierName: 'ร้านเจ๊หน่อย' } },
      }),
    );
    expect(paid).toMatchObject({ kind: 'SUPPLIER_PAYMENT', label: 'จ่ายผู้จัดจำหน่าย · ชำระค่าสินค้า', po: { id: 'po1', number: 'PO-20261018-0007', supplierName: 'ร้านเจ๊หน่อย' } });
    const reversed = classifyPettyCashLine(
      line({
        debit: new Decimal('486'),
        entry: { ...line({}).entry, metadata: { flow: 'shop-supplier-payment', tag: 'SHOP_SUPPLIER_PAYMENT_REVERSAL', kind: 'DEPOSIT', poId: 'po1', poNumber: 'PO-20261018-0007', supplierName: 'ร้านเจ๊หน่อย' } },
      }),
    );
    expect(reversed).toMatchObject({ kind: 'SUPPLIER_PAYMENT_REVERSAL', label: 'ยกเลิกจ่ายผู้จัดจำหน่าย · มัดจำ' });
  });

  it('บรรทัดจากที่อื่น (JE มือ / flow ไม่รู้จัก / metadata ว่าง) = อื่น ๆ ใช้คำอธิบายของรายการ', () => {
    const other = classifyPettyCashLine(line({ debit: new Decimal('1'), entry: { ...line({}).entry, description: 'ปรับปรุงยอดยกมา', metadata: { flow: 'manual' } } }));
    expect(other).toMatchObject({ kind: 'OTHER', label: 'ปรับปรุงยอดยกมา' });
    expect(classifyPettyCashLine(line({ entry: { ...line({}).entry, description: '', metadata: null } }))).toMatchObject({ kind: 'OTHER', label: 'รายการบัญชีอื่น' });
  });
});

describe('withRunningBalance', () => {
  it('เรียงตามวันที่ลงบัญชีแล้วสะสมจากยอดยกมา · คืนลำดับใหม่สุดก่อน · ยอดปิด = ยอดบรรทัดสุดท้าย', () => {
    const rows = [
      { date: new Date('2026-10-18T05:00:00.000Z'), seq: 2, inAmount: new Decimal(0), outAmount: new Decimal('486') },
      { date: new Date('2026-10-10T05:00:00.000Z'), seq: 0, inAmount: new Decimal('10000'), outAmount: new Decimal(0) },
      { date: new Date('2026-10-15T05:00:00.000Z'), seq: 1, inAmount: new Decimal(0), outAmount: new Decimal('3000') },
    ];
    const out = withRunningBalance(new Decimal('0'), rows);
    expect(out.closing.toFixed(2)).toBe('6514.00');
    expect(out.rows.map((r) => [r.seq, r.balanceAfter.toFixed(2)])).toEqual([
      [2, '6514.00'],
      [1, '7000.00'],
      [0, '10000.00'],
    ]);
  });

  it('ไม่มีรายการ → ยอดปิด = ยอดยกมา', () => {
    const out = withRunningBalance(new Decimal('1234.56'), []);
    expect(out.rows).toEqual([]);
    expect(out.closing.toFixed(2)).toBe('1234.56');
  });
});

describe('computeHeadroom / resolveLimit', () => {
  it('เติมได้อีก = วงเงิน − คงเหลือ (ไม่ติดลบ) · เกินวงเงิน = คงเหลือ − วงเงิน (ไม่ติดลบ)', () => {
    const fixed = (v: { headroom: Decimal; overLimit: Decimal }) => ({ headroom: v.headroom.toFixed(2), overLimit: v.overLimit.toFixed(2) });
    expect(fixed(computeHeadroom(new Decimal('20000'), new Decimal('6514')))).toEqual({ headroom: '13486.00', overLimit: '0.00' });
    expect(fixed(computeHeadroom(new Decimal('5000'), new Decimal('6514')))).toEqual({ headroom: '0.00', overLimit: '1514.00' });
    expect(fixed(computeHeadroom(new Decimal('6514'), new Decimal('6514')))).toEqual({ headroom: '0.00', overLimit: '0.00' });
  });

  it('ไม่มีค่าตั้งค่า/ค่าเพี้ยน = ค่าเริ่มต้น 20,000 (DEFAULT) · มีค่า = SET', () => {
    const fixed = (v: { value: Decimal; source: string }) => ({ value: v.value.toFixed(2), source: v.source });
    expect(fixed(resolveLimit(null))).toEqual({ value: '20000.00', source: 'DEFAULT' });
    expect(fixed(resolveLimit('abc'))).toEqual({ value: '20000.00', source: 'DEFAULT' });
    expect(fixed(resolveLimit('-5'))).toEqual({ value: '20000.00', source: 'DEFAULT' });
    expect(fixed(resolveLimit('30000.50'))).toEqual({ value: '30000.50', source: 'SET' });
    expect(fixed(resolveLimit('0'))).toEqual({ value: '0.00', source: 'SET' });
  });
});

describe('thaiMonthRange', () => {
  it('ไม่ส่งเดือน = เดือนปัจจุบันตามเวลาไทย · ส่ง YYYY-MM = เดือนนั้น · ขอบเขตเที่ยงคืนไทย', () => {
    const now = new Date('2026-10-18T20:30:00.000Z'); // 19/10/2569 03:30 เวลาไทย
    const current = thaiMonthRange(undefined, now);
    expect(current).toMatchObject({ year: 2026, month: 10, key: '2026-10', label: 'ตุลาคม 2569' });
    expect(current.start.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(current.end.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    const sep = thaiMonthRange('2026-09', now);
    expect(sep).toMatchObject({ year: 2026, month: 9, key: '2026-09', label: 'กันยายน 2569' });
    expect(sep.start.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(sep.end.toISOString()).toBe('2026-09-30T17:00:00.000Z');
  });

  it('รูปแบบเดือนผิด → BadRequest', () => {
    expect(() => thaiMonthRange('2026-13')).toThrow('เดือนไม่ถูกต้อง');
    expect(() => thaiMonthRange('10/2569')).toThrow('เดือนไม่ถูกต้อง');
  });
});
