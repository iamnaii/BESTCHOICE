import { describe, expect, it } from 'vitest';
import {
  clawbackCarriedOf,
  commissionItemView,
  copiedLineFromStored,
  formLineFromStored,
  payrollLineTotals,
  payrollLinesPayload,
  withoutStoredSystemData,
  type StoredCommissionItem,
  type StoredPayrollLine,
} from '../payroll-lines';
import { newPayrollLine } from '../../types';

/**
 * Payroll D4 ส่วนที่ 2 (Task 6) — ฟอร์มส่งรายการหักที่คนกรอก (MANUAL) เท่านั้น (P2-R3 ฝั่งเว็บ) · หักคืนค่าคอม + รายการค่าคอม
 * อ่านอย่างเดียว ไม่ส่งกลับ (P2-R19.1) · สุทธิ/ฐาน WHT หักรายการหักจากระบบ (P2-R19.2) · ฐาน WHT สูตรเดียวกับ payrollTaxableGross (P2-R18)
 */

type ItemOverrides = Omit<Partial<StoredCommissionItem>, 'salesCommission'> & {
  salesCommission?: Partial<StoredCommissionItem['salesCommission']>;
};
const item = (over: ItemOverrides): StoredCommissionItem => ({
  id: 'it-1',
  salesCommissionId: 'sc-1',
  kind: 'PAY',
  accountCode: 'S51-1101',
  amount: '1200.00',
  releasedAt: null,
  ...over,
  salesCommission: {
    id: 'sc-1',
    period: '2026-10',
    commissionAmount: '1200.00',
    status: 'APPROVED',
    clawbackReason: null,
    clawbackAt: null,
    createdAt: '2026-10-03T03:00:00.000Z',
    contract: { contractNumber: 'CT-20261003-0012' },
    sale: { saleNumber: 'SL-20261003-0001' },
    ...over.salesCommission,
  },
});

const STORED: StoredPayrollLine = {
  userId: 'u1',
  employeeName: 'สมศรี มีสุข',
  baseSalary: '15000',
  ssoEmployee: '750',
  whtAmount: '0',
  customIncome: [
    { accountCode: 'S51-1101', name: 'ค่าคอมมิชชัน (2 รายการ)', amount: '1000.00', isTaxable: true, source: 'COMMISSION', quantity: null, rate: null, multiplier: null },
    { accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: '500.00', isTaxable: true, source: 'MANUAL' },
  ],
  customDeduction: [
    { accountCode: 'S21-1103', name: 'คืนเงินยืม', amount: '300.00', source: 'MANUAL' },
    // แถวก่อนมีคอลัมน์ source = กรอกเอง
    { accountCode: 'S11-3001', name: 'ทดรองจ่าย', amount: '200.00' },
    { accountCode: 'S51-1101', name: 'หักคืนค่าคอม (2 รายการ)', amount: '1000.00', source: 'COMMISSION_CLAWBACK' },
  ],
  commissionItems: [
    item({ id: 'p1', salesCommissionId: 'sc-1', amount: '600.00' }),
    item({ id: 'p2', salesCommissionId: 'sc-2', amount: '400.00', salesCommission: { id: 'sc-2', contract: null, sale: { saleNumber: 'SL-20261011-0045' }, createdAt: '2026-10-11T03:00:00.000Z' } }),
    item({
      id: 'c1', salesCommissionId: 'sc-3', kind: 'CLAWBACK', amount: '800.00',
      salesCommission: { id: 'sc-3', period: '2026-09', contract: null, sale: null, clawbackReason: 'ยกเลิกใบขาย', clawbackAt: '2026-11-05T03:00:00.000Z', status: 'CLAWED_BACK' },
    }),
  ],
  attendanceSummary: null,
  systemNotes: { review: [], warnings: [{ code: 'CLAWBACK_CARRIED', deducted: '1000.00', carried: '400.00' }] },
};

describe('stored deductions — only MANUAL ones are editable or sent (P2-R3)', () => {
  it('edit: MANUAL and source-less deductions go to the editable table; the clawback goes to the read-only system deductions', () => {
    const line = formLineFromStored(STORED);
    expect(line.customDeduction.map((r) => [r.accountCode, r.amount])).toEqual([
      ['S21-1103', '300'],
      ['S11-3001', '200'],
    ]);
    expect(line.systemDeductions).toEqual([
      { source: 'COMMISSION_CLAWBACK', accountCode: 'S51-1101', name: 'หักคืนค่าคอม (2 รายการ)', amount: '1000.00' },
    ]);
  });

  it('edit then save: the payload carries only the MANUAL deductions (never the clawback) and no commission rows', () => {
    const [sent] = payrollLinesPayload([formLineFromStored(STORED)]);
    expect(sent.customDeduction).toEqual([
      { accountCode: 'S21-1103', name: 'คืนเงินยืม', amount: 300 },
      { accountCode: 'S11-3001', name: 'ทดรองจ่าย', amount: 200 },
    ]);
    expect(sent.customIncome).toEqual([{ accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: 500, isTaxable: true }]);
    expect(sent).not.toHaveProperty('systemDeductions');
    expect(sent).not.toHaveProperty('commissionItems');
  });

  it('copy previous: the clawback deduction and the commission items are not copied', () => {
    const line = copiedLineFromStored(STORED);
    expect(line.customDeduction.map((r) => r.accountCode)).toEqual(['S21-1103', 'S11-3001']);
    expect(line.systemDeductions).toEqual([]);
    expect(line.commissionItems).toEqual([]);
    const [sent] = payrollLinesPayload([line]);
    expect(sent.customDeduction?.map((r) => r.accountCode)).toEqual(['S21-1103', 'S11-3001']);
  });

  it('withoutStoredSystemData (another person / period / scope) clears the system deductions and commission items too', () => {
    const cleared = withoutStoredSystemData(formLineFromStored(STORED));
    expect(cleared.systemDeductions).toEqual([]);
    expect(cleared.commissionItems).toEqual([]);
    expect(cleared.systemIncome).toEqual([]);
    expect(cleared.customDeduction).toHaveLength(2);
  });

  it('a new line starts with no system deductions or commission items', () => {
    expect(newPayrollLine().systemDeductions).toEqual([]);
    expect(newPayrollLine().commissionItems).toEqual([]);
  });
});

describe('commission items (P2-R21)', () => {
  it('reference = contract number ?? sale number ?? commission id · date = createdAt (PAY) / clawbackAt (CLAWBACK) · reason only for CLAWBACK', () => {
    const line = formLineFromStored(STORED);
    expect(line.commissionItems).toEqual([
      { kind: 'PAY', accountCode: 'S51-1101', amount: '600.00', reference: 'CT-20261003-0012', date: '2026-10-03T03:00:00.000Z', period: '2026-10', reason: null },
      { kind: 'PAY', accountCode: 'S51-1101', amount: '400.00', reference: 'SL-20261011-0045', date: '2026-10-11T03:00:00.000Z', period: '2026-10', reason: null },
      { kind: 'CLAWBACK', accountCode: 'S51-1101', amount: '800.00', reference: 'sc-3', date: '2026-11-05T03:00:00.000Z', period: '2026-09', reason: 'ยกเลิกใบขาย' },
    ]);
  });

  it('released items (a voided payroll keeps them for history) are not shown as live items', () => {
    expect(commissionItemView(item({ releasedAt: '2026-11-10T00:00:00.000Z' }))).toBeNull();
  });

  it('clawbackCarriedOf reads the line CLAWBACK_CARRIED warning (summed if the server ever sends more than one)', () => {
    expect(clawbackCarriedOf(STORED.systemNotes)).toEqual({ deducted: '1000.00', carried: '400.00' });
    expect(
      clawbackCarriedOf({
        review: [],
        warnings: [
          { code: 'CLAWBACK_CARRIED', deducted: '100.00', carried: '50.00' },
          { code: 'CLAWBACK_CARRIED', deducted: '0.00', carried: '25.50' },
        ],
      }),
    ).toEqual({ deducted: '100.00', carried: '75.50' });
    expect(clawbackCarriedOf({ review: [], warnings: [] })).toBeNull();
    expect(clawbackCarriedOf(null)).toBeNull();
  });
});

describe('payrollLineTotals — net and the WHT base subtract system deductions (P2-R18 / P2-R19.2)', () => {
  it('golden of Task 5: base 15,000 + commission 1,000 − clawback 1,000 → WHT base 15,000; net subtracts the clawback and the typed deductions', () => {
    const t = payrollLineTotals(formLineFromStored(STORED));
    expect(t.systemIncome).toBe(1000);
    expect(t.income).toBe(1500);
    expect(t.systemDeduction).toBe(1000);
    expect(t.deduction).toBe(1500); // 300 + 200 typed + 1,000 clawback
    // payrollTaxableGross = base + taxable income − COMMISSION_CLAWBACK = 15,000 + 1,000 + 500 − 1,000
    expect(t.taxableBase).toBe(15500);
    // 15,000 + 1,500 − 750 SSO − 0 WHT − 1,500
    expect(t.netPaid).toBe(14250);
  });

  it('non-taxable typed income stays out of the WHT base; the base floors at 0', () => {
    const line = newPayrollLine({
      baseSalary: '0',
      customIncome: [{ uid: 'x', accountCode: 'S52-1204', name: 'เบี้ยเลี้ยง', amount: '100', isTaxable: false, isAdjustment: false }],
      systemDeductions: [{ source: 'COMMISSION_CLAWBACK', accountCode: 'S51-1101', name: 'หักคืนค่าคอม (1 รายการ)', amount: '500' }],
    });
    const t = payrollLineTotals(line);
    expect(t.taxableBase).toBe(0);
    expect(t.netPaid).toBe(0);
  });

  it('owner 2026-10-29 — commission WHT 3% is a system deduction: net subtracts it, the ภ.ง.ด.1 gross keeps the commission, the salary WHT base leaves commission and clawback out', () => {
    const line = newPayrollLine({
      baseSalary: '15000',
      ssoEmployee: '750',
      systemIncome: [
        { source: 'ATTENDANCE_OT', accountCode: 'S52-1202', name: 'OT', quantity: '1.5', rate: '93.75', multiplier: '1.5', amount: '140.63' },
        { source: 'COMMISSION', accountCode: 'S51-1101', name: 'ค่าคอมมิชชัน (2 รายการ)', quantity: null, rate: null, multiplier: null, amount: '1000.00' },
      ],
      systemDeductions: [
        { source: 'COMMISSION_CLAWBACK', accountCode: 'S51-1101', name: 'หักคืนค่าคอม (1 รายการ)', amount: '300.00' },
        { source: 'COMMISSION_WHT', accountCode: 'S21-3101', name: 'หัก ณ ที่จ่ายค่าคอม 3%', amount: '21.00' },
      ],
    });
    const t = payrollLineTotals(line);
    expect(t.commissionIncome).toBe(1000);
    expect(t.clawback).toBe(300);
    expect(t.commissionWht).toBe(21);
    expect(t.taxableBase).toBe(15840.63); // ภ.ง.ด.1: 15,000 + 140.63 + 1,000 − 300
    expect(t.salaryTaxableBase).toBe(15140.63); // ภาษีเงินเดือน: ไม่รวมค่าคอมและหักคืน
    expect(t.netPaid).toBe(15069.63); // 15,000 + 140.63 + 1,000 − 300 − 21 − 750
  });

  it('only COMMISSION_CLAWBACK system deductions reduce the WHT base (a future system deduction source would not)', () => {
    const line = newPayrollLine({
      baseSalary: '10000',
      systemDeductions: [{ source: 'SOMETHING_ELSE', accountCode: 'S21-1103', name: 'อื่น', amount: '300' }],
    });
    const t = payrollLineTotals(line);
    expect(t.taxableBase).toBe(10000);
    expect(t.netPaid).toBe(9700);
  });
});
