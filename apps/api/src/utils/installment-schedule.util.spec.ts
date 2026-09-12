import { Prisma } from '@prisma/client';
import { generatePaymentSchedule } from './installment.util';
import {
  buildInstallmentScheduleRows,
  ensureInstallmentSchedules,
  ScheduleSourceContract,
} from './installment-schedule.util';

describe('installment-schedule.util', () => {
  describe('buildInstallmentScheduleRows', () => {
    const base: ScheduleSourceContract = {
      id: 'c1',
      totalMonths: 12,
      financedAmount: 17000,
      interestTotal: 1190,
      monthlyPayment: '1515.83',
      paymentDueDay: 5,
      createdAt: new Date('2026-01-10T03:00:00.000Z'), // 2026-01-10 10:00 Bangkok
    };
    // Bangkok midnight as an instant (UTC+7, no DST) — what the Thai business calendar stores.
    const bkk = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day) - 7 * 3_600_000);

    it('matches the CPA rounding golden values (17000/12 ROUND_DOWN, 1190/12 ROUND_HALF_UP)', () => {
      const rows = buildInstallmentScheduleRows(base);
      expect(rows).toHaveLength(12);
      // principal = 17000/12 = 1416.6666… → ROUND_DOWN → 1416.66
      expect(new Prisma.Decimal(rows[0].principal as Prisma.Decimal).toString()).toBe('1416.66');
      // interest = 1190/12 = 99.1666… → ROUND_HALF_UP → 99.17
      expect(new Prisma.Decimal(rows[0].interest as Prisma.Decimal).toString()).toBe('99.17');
      // amountDue = monthlyPayment (incl VAT)
      expect(new Prisma.Decimal(rows[0].amountDue as Prisma.Decimal).toString()).toBe('1515.83');
      // every installment shares the same per-installment values
      expect(new Prisma.Decimal(rows[11].principal as Prisma.Decimal).toString()).toBe('1416.66');
    });

    it('numbers installments 1..N and steps due dates by month on paymentDueDay', () => {
      const rows = buildInstallmentScheduleRows(base);
      expect(rows[0].installmentNo).toBe(1);
      expect(rows[11].installmentNo).toBe(12);
      // i=1 → 2026-02-05, i=12 → 2027-01-05 (JS Date month overflow normalises)
      expect(rows[0].dueDate).toEqual(bkk(2026, 1, 5));
      expect(rows[11].dueDate).toEqual(bkk(2027, 0, 5));
    });

    it('falls back to createdAt day-of-month when paymentDueDay is null', () => {
      const rows = buildInstallmentScheduleRows({ ...base, paymentDueDay: null });
      expect(rows[0].dueDate).toEqual(bkk(2026, 1, 10));
    });

    it.each([29, 30, 31])('keeps payday %i within each target month, then restores the original day', (paymentDueDay) => {
      const rows = buildInstallmentScheduleRows({ ...base, paymentDueDay, totalMonths: 3 });
      expect(rows.map(row => row.dueDate)).toEqual([
        bkk(2026, 1, 28), bkk(2026, 2, paymentDueDay), bkk(2026, 3, Math.min(paymentDueDay, 30)),
      ]);
    });

    it('reads the contract date on the Bangkok calendar, not the process timezone', () => {
      // 2026-01-31 17:30 UTC is already 2026-02-01 00:30 in Bangkok: the schedule must start
      // from March, and every due date is Bangkok midnight — identical whether the process
      // runs in Asia/Bangkok (production API) or UTC (CI runner, an ad-hoc CLI).
      const rows = buildInstallmentScheduleRows({ ...base, createdAt: new Date('2026-01-31T17:30:00.000Z'), totalMonths: 2 });
      expect(rows.map(row => row.dueDate)).toEqual([bkk(2026, 2, 5), bkk(2026, 3, 5)]);
      expect((rows[0].dueDate as Date).toISOString()).toBe('2026-03-04T17:00:00.000Z');
      const fallback = buildInstallmentScheduleRows({ ...base, createdAt: new Date('2026-01-31T17:30:00.000Z'), paymentDueDay: null, totalMonths: 1 });
      expect(fallback[0].dueDate).toEqual(bkk(2026, 2, 1)); // createdAt's Bangkok day = 1
    });

    it('uses February 29 for an end-of-month payday in a leap year', () => {
      const rows = buildInstallmentScheduleRows({ ...base, createdAt: new Date('2028-01-10T03:00:00.000Z'), paymentDueDay: 31 });
      expect(rows[0].dueDate).toEqual(bkk(2028, 1, 29));
      expect(rows[1].dueDate).toEqual(bkk(2028, 2, 31));
    });

    it.each([25, 29, 30, 31])('matches the real Payment dates for payday %i', (paymentDueDay) => {
      // Real payments come from the anchored (Thai-calendar) path of generatePaymentSchedule —
      // ContractQuoteService passes the contract date as the anchor — so the schedule rows must
      // equal that on any runner timezone. 2026-01-31 12:00 Bangkok = 05:00Z.
      const createdAt = new Date('2026-01-31T05:00:00.000Z');
      const payments = generatePaymentSchedule('c1', 3, 3000, 1000, paymentDueDay, undefined, createdAt);
      const schedules = buildInstallmentScheduleRows({ ...base, createdAt, paymentDueDay, totalMonths: 3, financedAmount: 3000, monthlyPayment: 1000 });
      expect(schedules.map(row => row.dueDate)).toEqual(payments.map(row => row.dueDate));
      expect(schedules[0].dueDate).toEqual(bkk(2026, 1, Math.min(paymentDueDay, 28)));
    });

    it('treats null interestTotal / monthlyPayment as zero', () => {
      const rows = buildInstallmentScheduleRows({
        ...base,
        interestTotal: null,
        monthlyPayment: null,
      });
      expect(new Prisma.Decimal(rows[0].interest as Prisma.Decimal).toString()).toBe('0');
      expect(new Prisma.Decimal(rows[0].amountDue as Prisma.Decimal).toString()).toBe('0');
    });

    it('returns [] for a non-positive totalMonths (cannot divide)', () => {
      expect(buildInstallmentScheduleRows({ ...base, totalMonths: 0 })).toEqual([]);
      expect(buildInstallmentScheduleRows({ ...base, totalMonths: -3 })).toEqual([]);
    });

    it('accepts Prisma.Decimal money inputs (not just numbers/strings)', () => {
      const rows = buildInstallmentScheduleRows({
        ...base,
        financedAmount: new Prisma.Decimal('17000'),
        interestTotal: new Prisma.Decimal('1190'),
      });
      expect(new Prisma.Decimal(rows[0].principal as Prisma.Decimal).toString()).toBe('1416.66');
    });
  });

  describe('ensureInstallmentSchedules', () => {
    function mockTx(opts: { existingCount: number; contract?: Partial<ScheduleSourceContract> }) {
      const createMany = jest.fn().mockResolvedValue({ count: 0 });
      const tx = {
        installmentSchedule: {
          count: jest.fn().mockResolvedValue(opts.existingCount),
          createMany,
        },
        contract: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'c1',
            totalMonths: 12,
            financedAmount: new Prisma.Decimal('17000'),
            interestTotal: new Prisma.Decimal('1190'),
            monthlyPayment: new Prisma.Decimal('1515.83'),
            paymentDueDay: 5,
            createdAt: new Date(2026, 0, 10),
            ...opts.contract,
          }),
        },
      };
      return { tx, createMany };
    }

    it('skips generation (idempotent) when schedule rows already exist', async () => {
      const { tx, createMany } = mockTx({ existingCount: 12 });
      const res = await ensureInstallmentSchedules(tx as never, 'c1');
      expect(res).toEqual({ generated: 0 });
      expect(tx.contract.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(createMany).not.toHaveBeenCalled();
    });

    it('generates N rows when none exist yet', async () => {
      const { tx, createMany } = mockTx({ existingCount: 0 });
      const res = await ensureInstallmentSchedules(tx as never, 'c1');
      expect(res).toEqual({ generated: 12 });
      expect(createMany).toHaveBeenCalledTimes(1);
      const arg = createMany.mock.calls[0][0] as { data: unknown[] };
      expect(arg.data).toHaveLength(12);
    });

    it('does not generate when the contract has totalMonths <= 0', async () => {
      const { tx, createMany } = mockTx({ existingCount: 0, contract: { totalMonths: 0 } });
      const res = await ensureInstallmentSchedules(tx as never, 'c1');
      expect(res).toEqual({ generated: 0 });
      expect(createMany).not.toHaveBeenCalled();
    });
  });
});
