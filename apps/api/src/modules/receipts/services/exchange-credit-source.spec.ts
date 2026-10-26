import { Decimal } from '@prisma/client/runtime/library';
import { exchangeCreditSourceFrom } from './exchange-credit-source';

const D = (n: string) => new Decimal(n);
const rc = (id: string, paidDate: string, receiptNumber: string, amount: string) => ({ id, paidDate: new Date(paidDate), receiptNumber, amount: D(amount) });
const base = {
  receipt: { id: 'r1', paymentMethod: 'CREDIT_BALANCE', receiptType: 'INSTALLMENT', isVoided: false },
  parentContractNumber: 'CT-OLD',
  transferred: D('1515.83'),
  creditNotes: [{ number: 'RT-44', originalNumber: 'RT-31' }],
};

describe('exchangeCreditSourceFrom (spec §6 — Σ ใบ CREDIT_BALANCE ถึงใบนี้ ≤ T)', () => {
  it('ใบแรกที่ใช้เครดิต (Σ = T) → แสดงที่มา', () => {
    const out = exchangeCreditSourceFrom({ ...base, creditBalanceReceipts: [rc('r1', '2026-10-15', 'RT-45', '1515.83')] });
    expect(out).toEqual({ parentContractNumber: 'CT-OLD', transferred: D('1515.83'), creditNotes: base.creditNotes });
  });
  it('ใบที่สองเกิน T (เครดิตจากจ่ายเกินทีหลัง) → null · ใบแรกยังแสดง', () => {
    const rows = [rc('r1', '2026-10-15', 'RT-45', '1515.83'), rc('r2', '2026-11-15', 'RT-60', '500')];
    expect(exchangeCreditSourceFrom({ ...base, creditBalanceReceipts: rows })).not.toBeNull();
    expect(exchangeCreditSourceFrom({ ...base, receipt: { ...base.receipt, id: 'r2' }, creditBalanceReceipts: rows })).toBeNull();
  });
  it('เรียง paidDate แล้ว receiptNumber — ใบวันเดียวกันเลขน้อยกว่ามาก่อน', () => {
    const rows = [rc('r2', '2026-10-15', 'RT-46', '1000'), rc('r1', '2026-10-15', 'RT-45', '1000')];
    expect(exchangeCreditSourceFrom({ ...base, transferred: D('1000'), creditBalanceReceipts: rows })).not.toBeNull();
    expect(exchangeCreditSourceFrom({ ...base, transferred: D('1000'), receipt: { ...base.receipt, id: 'r2' }, creditBalanceReceipts: rows })).toBeNull();
  });
  it('ไม่ใช่ช่องทางเครดิต / ไม่มีสัญญาเดิม / T = 0 / ใบถูกยกเลิก → null', () => {
    const rows = [rc('r1', '2026-10-15', 'RT-45', '1515.83')];
    expect(exchangeCreditSourceFrom({ ...base, receipt: { ...base.receipt, paymentMethod: 'CASH' }, creditBalanceReceipts: rows })).toBeNull();
    expect(exchangeCreditSourceFrom({ ...base, parentContractNumber: null, creditBalanceReceipts: rows })).toBeNull();
    expect(exchangeCreditSourceFrom({ ...base, transferred: null, creditBalanceReceipts: rows })).toBeNull();
    expect(exchangeCreditSourceFrom({ ...base, receipt: { ...base.receipt, isVoided: true }, creditBalanceReceipts: rows })).toBeNull();
  });
});
