import { Prisma } from '@prisma/client';
import { bangkokMidnight } from '../../../../utils/date.util';
import type { ScheduleRules } from '../../../attendance/attendance-rules';
import {
  displayRate,
  holidayWorkHours,
  isAutoOtEligible,
  monthPayHours,
  payrollAttendanceLockKey,
  payrollCutoff,
  payrollTaxableGross,
  systemIncomeAmount,
  type PayDay,
} from '../payroll-pay';

const D = (v: number | string) => new Prisma.Decimal(v);
const RULES: ScheduleRules = { workStart: '10:00', workEnd: '19:00', lateGraceMinutes: 15 };
const workDate = bangkokMidnight(2026, 9, 11); // 2026-10-11
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(workDate.getTime() + (h * 60 + m) * 60_000);
};
const holiday = (inAt: string, outAt: string | null) => ({ workDate, clockIn: at(inAt), clockOut: outAt ? at(outAt) : null, rules: RULES });

describe('systemIncomeAmount / displayRate', () => {
  it.each([
    [15000, 1.5, 6.5, '609.38'],
    [15000, 1, 8, '500.00'],
    [15000, 3, 2, '375.00'],
    [16500, 1.5, 1.5, '154.69'],
  ])('base %s x%s x %sh = %s', (base, mult, hours, expected) => {
    expect(systemIncomeAmount(D(base), D(mult), D(hours)).toFixed(2)).toBe(expected);
  });

  it('displayRate is 4 dp', () => {
    expect(displayRate(D(15000), D(1.5)).toFixed(4)).toBe('93.7500');
    expect(displayRate(D(16500), D(1.5)).toFixed(4)).toBe('103.1250');
  });
});

describe('holidayWorkHours (rules 10:00-19:00)', () => {
  it.each([
    ['13:00', '21:00', 5],
    ['10:00', '21:00', 8],
    ['09:00', '12:10', 2],
    ['10:00', '14:59', 5],
    ['10:00', '15:00', 5],
    ['10:00', '16:00', 5],
    ['10:00', '17:00', 6],
  ])('%s-%s = %s', (a, b, expected) => {
    expect(holidayWorkHours(holiday(a, b))).toBe(expected);
  });

  it('no clock-out = 0', () => {
    expect(holidayWorkHours(holiday('10:00', null))).toBe(0);
  });

  it('is monotonic over every minute 10:01-19:00', () => {
    let prev = 0;
    for (let m = 10 * 60 + 1; m <= 19 * 60; m++) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const h = holidayWorkHours(holiday('10:00', `${hh}:${mm}`));
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
  });
});

describe('monthPayHours', () => {
  const day = (over: Partial<PayDay>): PayDay => ({
    workDate, branchId: 'b1', dayKind: 'WORK', clockIn: at('10:00'), clockOut: at('19:30'), otHours: D(0.5), lateMinutes: 0, flags: [], ...over,
  });

  it('sums stored OT first, then rounds the money once', () => {
    const r = monthPayHours([day({}), day({}), day({})], () => RULES);
    expect(r.otHours.toFixed(1)).toBe('1.5');
    expect(systemIncomeAmount(D(15000), D(1.5), r.otHours).toFixed(2)).toBe('140.63');
  });

  it('counts LEAVE_* with a clock-in, ignores days without clock-in', () => {
    const r = monthPayHours([day({ dayKind: 'LEAVE_SICK' }), day({ clockIn: null, clockOut: null })], () => RULES);
    expect(r.otHours.toFixed(1)).toBe('0.5');
  });

  it('holiday: hours and OT recomputed with current rules, stored OT ignored', () => {
    const r = monthPayHours(
      [day({ dayKind: 'DAY_OFF', clockIn: at('13:00'), clockOut: at('21:00'), otHours: D(2) })],
      () => ({ ...RULES, workEnd: '20:00' }),
    );
    expect(r.holidayHours.toFixed(1)).toBe('6.0');
    expect(r.holidayOtHours.toFixed(1)).toBe('1.0');
    expect(r.otHours.toFixed(1)).toBe('0.0');
    expect(r.holidayWorkedDays).toBe(1);
  });
});

describe('payrollCutoff / lock key / eligibility', () => {
  it('cutoff is 18:00 BKK on day 1 of next month', () => {
    expect(payrollCutoff('2026-10').toISOString()).toBe('2026-11-01T11:00:00.000Z');
    expect(payrollCutoff('2026-12').toISOString()).toBe('2027-01-01T11:00:00.000Z');
  });

  it('lock key', () => {
    expect(payrollAttendanceLockKey('u1', '2026-10')).toBe('payroll-attendance:u1:2026-10');
  });

  it('isAutoOtEligible', () => {
    expect(isAutoOtEligible({ employmentType: 'MONTHLY', baseSalary: D(15000) })).toBe(true);
    expect(isAutoOtEligible({ employmentType: 'DAILY', baseSalary: D(15000) })).toBe(false);
    expect(isAutoOtEligible({ employmentType: 'MONTHLY', baseSalary: null })).toBe(false);
    expect(isAutoOtEligible({ employmentType: 'MONTHLY', baseSalary: D(0) })).toBe(false);
    expect(isAutoOtEligible(null)).toBe(false);
  });
});

describe('payrollTaxableGross', () => {
  const line = (o: Partial<Parameters<typeof payrollTaxableGross>[0]> = {}) => ({ baseSalary: D(15000), customIncome: [], customDeduction: [], ...o });
  it('base + taxable income - clawback; golden 15000.00', () => {
    const g = payrollTaxableGross(
      line({
        customIncome: [{ amount: D(1000), isTaxable: true }],
        customDeduction: [
          { amount: D(1000), source: 'COMMISSION_CLAWBACK' },
          { amount: D(300), source: 'MANUAL' },
        ],
      }),
    );
    expect(g.toFixed(2)).toBe('15000.00');
  });
  it('non-taxable income contributes 0; isTaxable undefined counts', () => {
    expect(payrollTaxableGross(line({ customIncome: [{ amount: D(500), isTaxable: false }, { amount: D(200) }] })).toFixed(2)).toBe('15200.00');
  });
  it('manual deduction contributes 0', () => {
    expect(payrollTaxableGross(line({ customDeduction: [{ amount: D(300), source: 'MANUAL' }] })).toFixed(2)).toBe('15000.00');
  });
  it('a deduction row without a clawback source contributes 0', () => {
    expect(payrollTaxableGross(line({ customDeduction: [{ amount: D(400) } as never] })).toFixed(2)).toBe('15000.00');
  });
  it('tolerates missing arrays', () => {
    expect(payrollTaxableGross({ baseSalary: D(15000) }).toFixed(2)).toBe('15000.00');
  });
  it('floors at 0', () => {
    expect(payrollTaxableGross(line({ baseSalary: D(100), customDeduction: [{ amount: D(900), source: 'COMMISSION_CLAWBACK' }] })).toFixed(2)).toBe('0.00');
  });
});
