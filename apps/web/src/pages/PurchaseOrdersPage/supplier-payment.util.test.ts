import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  openSlip,
  cancelOutcomeErrors,
  cancelPreviewLines,
  paymentChip,
  paymentFormErrors,
  planPayment,
  previewLines,
  type SupplierPaymentSummary,
} from './supplier-payment.util';

const summary = (over: Partial<SupplierPaymentSummary> = {}): SupplierPaymentSummary => ({
  netAmount: '15729.00',
  paidTotal: '5000.00',
  remainingOnPo: '10729.00',
  payableOutstanding: '10729.00',
  payableByAccount: { 'S21-1102': '2729.00', 'S21-1101': '8000.00' },
  depositOutstanding: '0.00',
  hasBookedPayable: true,
  status: 'PARTIALLY_PAID',
  ...over,
});

describe('planPayment — ชนิดรายการตามฐานะใบสั่งซื้อ (กติกาเดียวกับ API)', () => {
  it('มีเจ้าหนี้ → ชำระเรียงรหัสบัญชีจนเต็ม ส่วนเกิน = มัดจำ', () => {
    expect(planPayment(summary(), 10729)).toEqual({
      settlement: [
        { accountCode: 'S21-1101', amount: 8000 },
        { accountCode: 'S21-1102', amount: 2729 },
      ],
      settled: 10729,
      deposit: 0,
    });
    expect(planPayment(summary({ payableOutstanding: '10486.00', payableByAccount: { 'S21-1101': '10486.00' }, remainingOnPo: '15729.00' }), 12000)).toEqual({
      settlement: [{ accountCode: 'S21-1101', amount: 10486 }],
      settled: 10486,
      deposit: 1514,
    });
  });
  it('ยังไม่มีเจ้าหนี้ → มัดจำทั้งก้อน', () => {
    expect(planPayment(summary({ payableOutstanding: '0.00', payableByAccount: {}, hasBookedPayable: false }), 5000)).toEqual({ settlement: [], settled: 0, deposit: 5000 });
  });
});

describe('paymentChip', () => {
  it('ชำระค่าสินค้าเมื่อมีเจ้าหนี้ · มัดจำเมื่อยังไม่รับของ', () => {
    expect(paymentChip(summary())).toEqual({ label: 'ชำระค่าสินค้า · รับของแล้ว', tone: 'settlement' });
    expect(paymentChip(summary({ payableOutstanding: '0.00', payableByAccount: {}, hasBookedPayable: false }))).toEqual({ label: 'มัดจำ · ยังไม่รับของ', tone: 'deposit' });
  });
});

describe('paymentFormErrors', () => {
  const ok = { paidAt: '2026-10-05', amount: '10729', slipUrl: 'data:image/png;base64,x', reference: '', note: '' };
  it('ฟอร์มครบ → ไม่มี error', () => {
    expect(paymentFormErrors(ok, summary(), '2026-10-05')).toEqual({});
  });
  it('จำนวนว่าง/ศูนย์/เกินเพดาน · วันที่ว่าง/อนาคต · ไม่มีสลิป', () => {
    expect(paymentFormErrors({ ...ok, amount: '' }, summary(), '2026-10-05').amount).toMatch(/จำนวนเงิน/);
    expect(paymentFormErrors({ ...ok, amount: '0' }, summary(), '2026-10-05').amount).toMatch(/มากกว่า 0/);
    expect(paymentFormErrors({ ...ok, amount: '10730' }, summary(), '2026-10-05').amount).toMatch(/ไม่เกิน 10,729\.00/);
    expect(paymentFormErrors({ ...ok, paidAt: '' }, summary(), '2026-10-05').paidAt).toMatch(/วันที่/);
    expect(paymentFormErrors({ ...ok, paidAt: '2026-10-06' }, summary(), '2026-10-05').paidAt).toMatch(/ไม่เกินวันนี้/);
    expect(paymentFormErrors({ ...ok, slipUrl: '  ' }, summary(), '2026-10-05').slipUrl).toMatch(/สลิป/);
  });
});

describe('previewLines — รายการบัญชีที่จะลง (สมดุล)', () => {
  it('ชำระ: Dr เจ้าหนี้ตามปัน / Cr ธนาคารจ่ายออก', () => {
    expect(previewLines(summary(), 10729)).toEqual([
      { accountCode: 'S21-1101', label: 'เจ้าหนี้ - ซัพพลายเออร์มือถือ', debit: 8000, credit: 0 },
      { accountCode: 'S21-1102', label: 'เจ้าหนี้ - อุปกรณ์เสริม', debit: 2729, credit: 0 },
      { accountCode: 'S11-1202', label: 'ธนาคารหน้าร้าน (จ่ายออก)', debit: 0, credit: 10729 },
    ]);
  });
  it('จ่ายเกินเจ้าหนี้: บรรทัดมัดจำ S11-4201 เพิ่ม · ไม่มีเจ้าหนี้: มัดจำอย่างเดียว · ยอดศูนย์: ว่าง', () => {
    const split = previewLines(summary({ payableOutstanding: '10486.00', payableByAccount: { 'S21-1101': '10486.00' }, remainingOnPo: '15729.00' }), 12000);
    expect(split.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['S21-1101', 10486, 0],
      ['S11-4201', 1514, 0],
      ['S11-1202', 0, 12000],
    ]);
    expect(previewLines(summary({ payableOutstanding: '0.00', payableByAccount: {} }), 5000).map((l) => l.accountCode)).toEqual(['S11-4201', 'S11-1202']);
    expect(previewLines(summary(), 0)).toEqual([]);
  });
});

describe('cancelOutcomeErrors / cancelPreviewLines — ปิดมัดจำตอนยกเลิกใบสั่งซื้อ', () => {
  const base = { depositOutcome: 'REFUNDED' as const, refundedAt: '2026-10-05', refundAmount: '3000', slipUrl: 'https://x/r.jpg', reason: '' };
  it('ได้คืน: วันที่ · จำนวน (0 < x ≤ มัดจำค้าง) · หลักฐาน บังคับ', () => {
    expect(cancelOutcomeErrors(base, 3000, '2026-10-05')).toEqual({});
    expect(cancelOutcomeErrors({ ...base, refundedAt: '2026-10-06' }, 3000, '2026-10-05').refundedAt).toMatch(/ไม่เกินวันนี้/);
    expect(cancelOutcomeErrors({ ...base, refundAmount: '0' }, 3000, '2026-10-05').refundAmount).toMatch(/ไม่ได้คืน/);
    expect(cancelOutcomeErrors({ ...base, refundAmount: '5000' }, 3000, '2026-10-05').refundAmount).toMatch(/ไม่เกินมัดจำค้าง 3,000\.00/);
    expect(cancelOutcomeErrors({ ...base, slipUrl: '' }, 3000, '2026-10-05').slipUrl).toMatch(/หลักฐาน/);
  });
  it('ไม่ได้คืน: เหตุผลบังคับ', () => {
    expect(cancelOutcomeErrors({ ...base, depositOutcome: 'FORFEITED', reason: '' }, 3000, '2026-10-05').reason).toMatch(/เหตุผล/);
    expect(cancelOutcomeErrors({ ...base, depositOutcome: 'FORFEITED', reason: 'ริบ' }, 3000, '2026-10-05')).toEqual({});
  });
  it('พรีวิว: ได้คืนครบ / ได้คืนไม่ครบ / ไม่ได้คืน', () => {
    expect(cancelPreviewLines(base, 3000).map((l) => [l.accountCode, l.debit, l.credit])).toEqual([['S11-1201', 3000, 0], ['S11-4201', 0, 3000]]);
    expect(cancelPreviewLines({ ...base, refundAmount: '2000' }, 3000).map((l) => [l.accountCode, l.debit, l.credit])).toEqual([['S11-1201', 2000, 0], ['S53-1105', 1000, 0], ['S11-4201', 0, 3000]]);
    expect(cancelPreviewLines({ ...base, depositOutcome: 'FORFEITED' }, 3000).map((l) => [l.accountCode, l.debit, l.credit])).toEqual([['S53-1105', 3000, 0], ['S11-4201', 0, 3000]]);
  });
});

describe('openSlip — เปิดสลิปดู (data URL เปิดแท็บใหม่ตรง ๆ ไม่ได้ ต้องแปลงเป็น blob)', () => {
  afterEach(() => vi.restoreAllMocks());
  it('data URL → สร้าง blob URL แล้ว window.open · URL ปกติ → เปิดตรง', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const create = vi.fn(() => 'blob:mock-1');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    openSlip('data:image/png;base64,iVBORw0KGgo=');
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0] as unknown[])[0]).toBeInstanceOf(Blob);
    expect(open).toHaveBeenCalledWith('blob:mock-1', '_blank', 'noopener');
    openSlip('https://files.example/slip.jpg');
    expect(open).toHaveBeenLastCalledWith('https://files.example/slip.jpg', '_blank', 'noopener');
  });
});
