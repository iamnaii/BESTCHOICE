import { Prisma } from '@prisma/client';

import type { LateFeeConfig } from '../../utils/late-fee.util';
import { bkkMonthKey, lateFeeAtPostDate, remainingInstallmentDue } from './_drive-helpers';

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

const d = (s: string | number) => new Prisma.Decimal(s);
/** ขั้นบันได default เดียวกับ BUSINESS_RULES (50/100/≥3 วัน) */
const cfg: LateFeeConfig = { tier1Amount: 50, tier2Amount: 100, tier2MinDays: 3 };
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('lateFeeAtPostDate (mirror payment-receipt-orchestrator.ts:268-284)', () => {
  it('เลยกำหนด 1-2 วัน ณ postDate → tier1 (50) ไม่ใช่ค่าที่ stamp ไว้', () => {
    expect(
      lateFeeAtPostDate(
        {
          dueDate: day('2026-08-10'),
          amountDue: d('1515.83'),
          lateFee: d('100'),
          lateFeeWaived: false,
        },
        cfg,
        day('2026-08-12'),
      ).toFixed(2),
    ).toBe('50.00');
  });

  it('เลยกำหนด ≥3 วัน ณ postDate → tier2 (100) แม้แถว stamp ไว้ 0', () => {
    expect(
      lateFeeAtPostDate(
        {
          dueDate: day('2026-08-10'),
          amountDue: d('1515.83'),
          lateFee: d('0'),
          lateFeeWaived: false,
        },
        cfg,
        day('2026-08-20'),
      ).toFixed(2),
    ).toBe('100.00');
  });

  it('ยังไม่เลยกำหนด ณ postDate → ใช้ค่าที่ stamp ไว้ (service ไม่ recompute กิ่งนี้)', () => {
    // seeder stamp เทียบ "วันนี้" — POST_DATE ย้อนหลังก่อน dueDate ทำให้กิ่งนี้เกิดจริง
    expect(
      lateFeeAtPostDate(
        {
          dueDate: day('2026-08-20'),
          amountDue: d('1515.83'),
          lateFee: d('100'),
          lateFeeWaived: false,
        },
        cfg,
        day('2026-08-15'),
      ).toFixed(2),
    ).toBe('100.00');
  });

  it('waived → ใช้ค่าที่ stamp ไว้ (flow อนุโลมจริง zero คอลัมน์ให้แล้ว = 0)', () => {
    expect(
      lateFeeAtPostDate(
        {
          dueDate: day('2026-08-10'),
          amountDue: d('1515.83'),
          lateFee: d('0'),
          lateFeeWaived: true,
        },
        cfg,
        day('2026-08-20'),
      ).isZero(),
    ).toBe(true);
  });
});

describe('remainingInstallmentDue (FEE-FIRST — PR #1313, ค่าปรับ resolve ณ postDate)', () => {
  it('งวดยังไม่จ่ายเลย ยังไม่เลยกำหนด = amountDue เต็ม', () => {
    expect(
      remainingInstallmentDue(
        {
          dueDate: day('2026-08-20'),
          amountDue: d('1515.83'),
          amountPaid: d('0'),
          lateFee: d('0'),
          lateFeeWaived: false,
        },
        cfg,
        day('2026-08-15'),
      ).toFixed(2),
    ).toBe('1515.83');
  });

  it('งวดค้าง ≥3 วัน — เต็มงวดรวมค่าปรับ tier2 เสมอ ไม่ว่าคอลัมน์ stamp อะไรไว้', () => {
    expect(
      remainingInstallmentDue(
        {
          dueDate: day('2026-08-01'),
          amountDue: d('1515.83'),
          amountPaid: d('0'),
          lateFee: d('50'),
          lateFeeWaived: false,
        },
        cfg,
        day('2026-08-20'),
      ).toFixed(2),
    ).toBe('1615.83');
  });

  it('จ่ายบางส่วนแล้ว (FEE-FIRST) — เหลือ due + fee ณ postDate − paid', () => {
    // ค้าง 40 วัน → tier2 = 100: 1515.83 + 100 − 1000 = 615.83
    expect(
      remainingInstallmentDue(
        {
          dueDate: day('2026-07-11'),
          amountDue: d('1515.83'),
          amountPaid: d('1000'),
          lateFee: d('100'),
          lateFeeWaived: false,
        },
        cfg,
        day('2026-08-20'),
      ).toFixed(2),
    ).toBe('615.83');
  });

  it('ค่าปรับถูกอนุโลมทั้งงวด (คอลัมน์ถูก zero โดย flow อนุโลม) — ไม่นับค่าปรับ', () => {
    expect(
      remainingInstallmentDue(
        {
          dueDate: day('2026-08-01'),
          amountDue: d('1515.83'),
          amountPaid: d('500'),
          lateFee: d('0'),
          lateFeeWaived: true,
        },
        cfg,
        day('2026-08-20'),
      ).toFixed(2),
    ).toBe('1015.83');
  });

  it('จ่ายครบแล้ว ไม่เลยกำหนด = 0 (ผู้เรียกต้อง skip เมื่อ ≤ 0)', () => {
    expect(
      remainingInstallmentDue(
        {
          dueDate: day('2026-08-20'),
          amountDue: d('1515.83'),
          amountPaid: d('1515.83'),
          lateFee: d('0'),
          lateFeeWaived: false,
        },
        cfg,
        day('2026-08-15'),
      ).isZero(),
    ).toBe(true);
  });

  it('รับค่าจาก Prisma ได้ทั้ง Decimal/string/number โดยไม่เสีย precision', () => {
    // ค้าง 1 วัน → tier1 = 50: 1515.83 + 50 − 0 = 1565.83
    expect(
      remainingInstallmentDue(
        {
          dueDate: day('2026-08-19'),
          amountDue: '1515.83',
          amountPaid: 0,
          lateFee: '99.17',
          lateFeeWaived: false,
        },
        cfg,
        day('2026-08-20'),
      ).toFixed(2),
    ).toBe('1565.83');
  });
});
