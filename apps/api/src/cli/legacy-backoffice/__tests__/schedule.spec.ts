import { Prisma } from '@prisma/client';
import { bangkokMidnight } from '../../../utils/date.util';
import { buildInstallmentScheduleRows } from '../../../utils/installment-schedule.util';
import type { LegacyInstallment } from '../legacy-book';
import type { ContractMoney } from '../money';
import { buildImportSchedule } from '../schedule';

/**
 * ตารางงวดของสัญญาที่นำเข้า — ข้อมูลสังเคราะห์ (ตัวอย่าง CPA 17,000 / 12 งวด)
 * วันครบกำหนดของระบบเก่าตั้งใจให้ไม่ตรงรูปแบบ "วันทำสัญญา + i เดือน" ของระบบใหม่
 */

const D = (value: string) => new Prisma.Decimal(value);
const CONTRACT_ID = '00000000-0000-4000-8000-000000000001';
const CREATED_AT = new Date('2026-01-05T10:00:00+07:00');

function money(over: Partial<ContractMoney> = {}): ContractMoney {
  return {
    sellingPrice: D('12000'),
    downPayment: D('2000'),
    financedAmount: D('10000'),
    storeCommission: D('1000'),
    interestTotal: D('6000'),
    vatAmount: D('1190'),
    vatPct: D('0.07'),
    interestRate: D('0'),
    monthlyPayment: D('1515.83'),
    totalMonths: 12,
    ...over,
  };
}

/** ครบกำหนดวันที่ 25 (ระบบใหม่จะใช้วันที่ 5 ตามวันทำสัญญา) · ข้าม ก.ค. ไปหนึ่งเดือน */
function legacyInstallments(count = 12): LegacyInstallment[] {
  return Array.from({ length: count }, (_, i) => {
    const month = 1 + i + (i >= 5 ? 1 : 0);
    return {
      legacyId: String(2000 + i),
      legacyCode: `TEST-I-${2000 + i}`,
      dueDate: bangkokMidnight(2026, month, 25),
      amount: D(i === count - 1 ? '1515.87' : '1515.83'),
      paid: D('0'),
      balance: D('1515.83'),
      statusCode: '0',
    };
  });
}

describe('buildImportSchedule', () => {
  it('uses the legacy due dates (Bangkok midnight) and installmentNo 1..n', () => {
    const inst = legacyInstallments();
    const rows = buildImportSchedule(CONTRACT_ID, money(), inst, CREATED_AT);
    expect(rows.map((r) => r.installmentNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows.map((r) => r.dueDate)).toEqual(inst.map((i) => i.dueDate));
    expect(rows.every((r) => r.contractId === CONTRACT_ID)).toBe(true);
    // เที่ยงคืนกรุงเทพ = 17:00 UTC ของวันก่อนหน้า
    expect((rows[0].dueDate as Date).toISOString()).toBe('2026-02-24T17:00:00.000Z');
    // งวด 6 ข้าม ก.ค. → 25 ส.ค.
    expect((rows[5].dueDate as Date).toISOString()).toBe('2026-08-24T17:00:00.000Z');
  });

  it('principal / interest / amountDue equal buildInstallmentScheduleRows for the same contract', () => {
    const m = money();
    const rows = buildImportSchedule(CONTRACT_ID, m, legacyInstallments(), CREATED_AT);
    const expected = buildInstallmentScheduleRows({
      id: CONTRACT_ID,
      totalMonths: m.totalMonths,
      financedAmount: m.financedAmount,
      interestTotal: m.interestTotal,
      monthlyPayment: m.monthlyPayment,
      paymentDueDay: null,
      createdAt: CREATED_AT,
    });
    const withoutDue = (list: Prisma.InstallmentScheduleCreateManyInput[]) =>
      list.map(({ dueDate: _dueDate, ...rest }) => rest);
    expect(withoutDue(rows)).toEqual(withoutDue(expected));
    // เฉพาะวันครบกำหนดที่ต่าง
    expect(rows[0].dueDate).not.toEqual(expected[0].dueDate);
  });

  it('keeps the real interest per installment (ร่าง 5): 10,000 / 6,000 / 12 → 833.33 / 500.00', () => {
    const rows = buildImportSchedule(CONTRACT_ID, money(), legacyInstallments(), CREATED_AT);
    const view = rows.map((r) => [
      new Prisma.Decimal(r.principal.toString()).toFixed(2),
      new Prisma.Decimal(r.interest.toString()).toFixed(2),
      new Prisma.Decimal((r.amountDue ?? 0).toString()).toFixed(2),
    ]);
    expect(new Set(view.map((v) => v.join('|')))).toEqual(new Set(['833.33|500.00|1515.83']));
  });

  it('refuses when the legacy installment count differs from totalMonths', () => {
    expect(() =>
      buildImportSchedule(CONTRACT_ID, money(), legacyInstallments(11), CREATED_AT),
    ).toThrow('มีงวดในระบบเก่า 11 งวด แต่สัญญามี 12 งวด');
  });
});
