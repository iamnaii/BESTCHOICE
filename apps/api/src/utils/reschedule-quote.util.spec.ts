import { Prisma } from '@prisma/client';
import { computeRescheduleQuote } from './reschedule-quote.util';
import { LateFeeConfig } from './late-fee.util';

const D = (v: string | number) => new Prisma.Decimal(v);

// PER_DAY defaults (config.util BUSINESS_RULES): 20฿/day, max 500, cap 5%.
const cfg: LateFeeConfig = {
  mode: 'PER_DAY',
  tier1Amount: 50,
  tier2Amount: 100,
  tier2MinDays: 3,
  perDayRate: 20,
  maxAmount: 500,
  capPct: 5,
};

// Mockup case TEST-20260630-003: monthly 4,472; due 5 days ago → fee 100 (5×20).
const now = new Date('2026-07-02T05:00:00Z');
const overdue5d = new Date('2026-06-27T05:00:00Z');

const basePayment = {
  dueDate: overdue5d,
  amountDue: D('4472.00'),
  lateFeeWaived: false,
};

describe('computeRescheduleQuote — ปรับดิว collect-first quote (owner 2026-07-02)', () => {
  it('fee = monthly/30×days ROUND_UP whole baht (4472/30×7 = 1043.47 → 1044)', () => {
    const q = computeRescheduleQuote({
      monthlyPayment: D('4472.00'),
      daysToShift: 7,
      splitMode: 'SPLIT',
      payment: basePayment,
      lateFeeCfg: cfg,
      now,
    });
    expect(q.rescheduleFee.toFixed(2)).toBe('1044.00');
  });

  it('6a (SPLIT): collect = fee + late fee (1044 + 100 = 1144)', () => {
    const q = computeRescheduleQuote({
      monthlyPayment: D('4472.00'),
      daysToShift: 7,
      splitMode: 'SPLIT',
      payment: basePayment,
      lateFeeCfg: cfg,
      now,
    });
    expect(q.variant).toBe('6a');
    expect(q.lateFee.toFixed(2)).toBe('100.00'); // 5 days × 20฿
    expect(q.collectAmount.toFixed(2)).toBe('1144.00');
  });

  it('6b (SINGLE): collect = late fee only (fee rides the next installment)', () => {
    const q = computeRescheduleQuote({
      monthlyPayment: D('4472.00'),
      daysToShift: 7,
      splitMode: 'SINGLE',
      payment: basePayment,
      lateFeeCfg: cfg,
      now,
    });
    expect(q.variant).toBe('6b');
    expect(q.collectAmount.toFixed(2)).toBe('100.00');
  });

  it('6b + not overdue → collect 0 (ยืนยันได้เลย ไม่ต้องเก็บเงิน)', () => {
    const q = computeRescheduleQuote({
      monthlyPayment: D('4472.00'),
      daysToShift: 7,
      splitMode: 'SINGLE',
      payment: { ...basePayment, dueDate: new Date('2026-07-10T05:00:00Z') },
      lateFeeCfg: cfg,
      now,
    });
    expect(q.lateFee.toFixed(2)).toBe('0.00');
    expect(q.collectAmount.toFixed(2)).toBe('0.00');
  });

  it('waived late fee → 0 even when overdue', () => {
    const q = computeRescheduleQuote({
      monthlyPayment: D('4472.00'),
      daysToShift: 7,
      splitMode: 'SINGLE',
      payment: { ...basePayment, lateFeeWaived: true },
      lateFeeCfg: cfg,
      now,
    });
    expect(q.lateFee.toFixed(2)).toBe('0.00');
  });

  it('late fee honours the per-day caps (60 days × 20 = 1200 → capped at 5% × 4472 = 223.60)', () => {
    const q = computeRescheduleQuote({
      monthlyPayment: D('4472.00'),
      daysToShift: 7,
      splitMode: 'SINGLE',
      payment: { ...basePayment, dueDate: new Date('2026-05-03T05:00:00Z') },
      lateFeeCfg: cfg,
      now,
    });
    expect(q.lateFee.toFixed(2)).toBe('223.60');
  });
});
