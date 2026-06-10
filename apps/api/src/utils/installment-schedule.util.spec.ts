import { Prisma } from '@prisma/client';
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
      createdAt: new Date(2026, 0, 10), // 2026-01-10 (local)
    };

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
      expect(rows[0].dueDate).toEqual(new Date(2026, 1, 5));
      expect(rows[11].dueDate).toEqual(new Date(2027, 0, 5));
    });

    it('falls back to createdAt day-of-month when paymentDueDay is null', () => {
      const rows = buildInstallmentScheduleRows({ ...base, paymentDueDay: null });
      expect(rows[0].dueDate).toEqual(new Date(2026, 1, 10));
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
