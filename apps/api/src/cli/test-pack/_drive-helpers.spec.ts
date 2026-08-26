import { Prisma } from '@prisma/client';

import { bkkMonthKey, remainingInstallmentDue } from './_drive-helpers';

describe('bkkMonthKey', () => {
  it('อ่านเดือนตามเวลาไทย ไม่ใช่ UTC — 17:30Z ปลายเดือนคือเช้าวันที่ 1 เดือนถัดไปของไทย', () => {
    expect(bkkMonthKey(new Date('2026-08-31T17:30:00.000Z'))).toBe('202609');
  });

  it('UTC midnight ของวันกลางเดือน = เดือนเดียวกัน', () => {
    expect(bkkMonthKey(new Date('2026-08-15T00:00:00.000Z'))).toBe('202608');
  });

  it('POST_DATE (UTC midnight) กับเวลาปัจจุบันช่วงบ่ายไทยของวันเดียวกัน อยู่เดือนเดียวกัน', () => {
    // bkkMidnight ของ CLI เก็บเป็น UTC midnight ของวันไทย — ต้องเทียบเท่ากับ now ตอนบ่าย
    expect(bkkMonthKey(new Date('2026-08-26T00:00:00.000Z'))).toBe(
      bkkMonthKey(new Date('2026-08-26T07:00:00.000Z')),
    );
  });
});

describe('remainingInstallmentDue (FEE-FIRST — PR #1313)', () => {
  const d = (s: string) => new Prisma.Decimal(s);

  it('งวดยังไม่จ่ายเลย ไม่มีค่าปรับ = amountDue เต็ม', () => {
    expect(
      remainingInstallmentDue({
        amountDue: d('1515.83'),
        amountPaid: d('0'),
        lateFee: d('0'),
        lateFeeWaived: false,
      }).toFixed(2),
    ).toBe('1515.83');
  });

  it('งวดค้างมีค่าปรับ — เต็มงวดรวมค่าปรับเสมอ', () => {
    expect(
      remainingInstallmentDue({
        amountDue: d('1515.83'),
        amountPaid: d('0'),
        lateFee: d('100'),
        lateFeeWaived: false,
      }).toFixed(2),
    ).toBe('1615.83');
  });

  it('จ่ายบางส่วนแล้ว (FEE-FIRST) — เหลือ due + fee − paid ไม่ว่าเงินก้อนแรกถูกตัดเข้าค่าปรับก่อน', () => {
    // paid 1000: feeCollected = min(1000, 100) = 100, baseCash = 900
    // เหลือฐาน 615.83 + ค่าปรับ 0 = 615.83 — ตรงกับสูตรรวม 1515.83 + 100 − 1000
    expect(
      remainingInstallmentDue({
        amountDue: d('1515.83'),
        amountPaid: d('1000'),
        lateFee: d('100'),
        lateFeeWaived: false,
      }).toFixed(2),
    ).toBe('615.83');
  });

  it('ค่าปรับถูกอนุโลมทั้งงวด — ไม่นับค่าปรับ', () => {
    expect(
      remainingInstallmentDue({
        amountDue: d('1515.83'),
        amountPaid: d('500'),
        lateFee: d('100'),
        lateFeeWaived: true,
      }).toFixed(2),
    ).toBe('1015.83');
  });

  it('จ่ายครบแล้ว = 0 (ผู้เรียกต้อง skip เมื่อ ≤ 0)', () => {
    expect(
      remainingInstallmentDue({
        amountDue: d('1515.83'),
        amountPaid: d('1515.83'),
        lateFee: d('0'),
        lateFeeWaived: false,
      }).isZero(),
    ).toBe(true);
  });

  it('รับค่าจาก Prisma ได้ทั้ง Decimal/string/number โดยไม่เสีย precision', () => {
    expect(
      remainingInstallmentDue({
        amountDue: '1515.83',
        amountPaid: 0,
        lateFee: '99.17',
        lateFeeWaived: false,
      }).toFixed(2),
    ).toBe('1615.00');
  });
});
