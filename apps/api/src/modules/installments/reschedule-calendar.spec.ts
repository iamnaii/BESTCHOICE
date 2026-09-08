import { Prisma } from '@prisma/client';
import { RescheduleService } from './reschedule.service';
import { PrismaService } from '../../prisma/prisma.service';

const due = (date: string) => new Date(`${date}T00:00:00+07:00`);
const bkkDate = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

describe('RescheduleService monthly calendar', () => {
  function harness(dates: string[], firstNo = 5, paid: number[] = []) {
    const schedules = dates.map((date, index) => ({
      id: `schedule-${firstNo + index}`,
      installmentNo: firstNo + index,
      dueDate: due(date),
      amountDue: new Prisma.Decimal('4472'),
      rescheduledFromDate: null,
      rescheduleCount: 0,
    }));
    const prisma = {
      installmentSchedule: {
        findMany: jest.fn().mockResolvedValue(schedules),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue(paid.map((installmentNo) => ({ installmentNo }))),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ monthlyPayment: new Prisma.Decimal('4472') }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((body) => body(prisma));
    return { prisma, schedules, service: new RescheduleService(prisma as unknown as PrismaService) };
  }

  it('6a keeps October 11 for each monthly due across unequal months and February', async () => {
    const { service, prisma, schedules } = harness([
      '2026-09-27', '2026-10-27', '2026-11-27', '2026-12-27',
      '2027-01-27', '2027-02-27', '2027-03-27', '2027-04-27',
    ]);
    const result = await service.execute({
      contractId: 'contract-1', fromInstallmentNo: 5, daysToShift: 14, userId: 'user-1', variant: '6a',
    });
    expect(Object.values(result.newDueDates).map(bkkDate)).toEqual([
      '2026-10-11', '2026-11-11', '2026-12-11', '2027-01-11',
      '2027-02-11', '2027-03-11', '2027-04-11', '2027-05-11',
    ]);
    expect(result.rescheduleFee.toFixed(2)).toBe('2087.00');
    expect(prisma.installmentSchedule.update.mock.calls[1][0].data).toEqual({
      dueDate: due('2026-11-11'),
      rescheduledFromDate: schedules[1].dueDate,
      rescheduleCount: { increment: 1 },
    });
    expect(prisma.payment.updateMany.mock.calls[1][0]).toEqual({
      where: { contractId: 'contract-1', installmentNo: 6, deletedAt: null, status: { not: 'PAID' } },
      data: { dueDate: due('2026-11-11') },
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data.newValue).toMatchObject({
      firstShiftedOldDue: due('2026-09-27').toISOString(),
      firstShiftedNewDue: due('2026-10-11').toISOString(),
      shiftedInstallmentCount: 8,
    });
  });

  it('6b follows the initiating quoted October 4 anchor: the next installment is November 4', async () => {
    const { service, prisma } = harness(['2026-10-27', '2026-11-27', '2026-12-27']);
    const result = await service.execute({
      contractId: 'contract-1', fromInstallmentNo: 5, daysToShift: 7, variant: '6b',
      scheduleAnchor: { installmentNo: 4, dueDate: due('2026-10-04') },
    });
    expect(Object.values(result.newDueDates).map(bkkDate)).toEqual([
      '2026-11-04', '2026-12-04', '2027-01-04',
    ]);
    expect(prisma.payment.updateMany.mock.calls.map(([arg]) => arg.where.installmentNo)).toEqual([5, 6, 7]);
  });

  it.each([
    ['2026-01-30', '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'],
    ['2028-01-30', '2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30'],
  ])('clamps a 31st anchor without drifting after February (%s)', async (oldDue, ...expected) => {
    const year = oldDue.slice(0, 4);
    const { service } = harness([oldDue, `${year}-02-27`, `${year}-03-27`, `${year}-04-27`]);
    const result = await service.execute({ contractId: 'contract-1', fromInstallmentNo: 5, daysToShift: 1 });
    expect(Object.values(result.newDueDates).map(bkkDate)).toEqual(expected);
  });

  it('preserves PAID Payment and schedule history, keeping the skipped installment month', async () => {
    const { service, prisma } = harness(['2026-09-27', '2026-10-27', '2026-11-27'], 5, [6]);
    const result = await service.execute({ contractId: 'contract-1', fromInstallmentNo: 5, daysToShift: 14 });
    expect(result.shiftedInstallmentIds).toEqual(['schedule-5', 'schedule-7']);
    expect(Object.values(result.newDueDates).map(bkkDate)).toEqual(['2026-10-11', '2026-12-11']);
    expect(prisma.installmentSchedule.update.mock.calls.map(([arg]) => arg.where.id)).toEqual(['schedule-5', 'schedule-7']);
    expect(prisma.payment.findMany).toHaveBeenCalledWith({
      where: { contractId: 'contract-1', installmentNo: { gte: 5 }, deletedAt: null, status: 'PAID' },
      select: { installmentNo: true },
    });
  });

  it('retains the installment-number gap rather than compressing the payment calendar', async () => {
    const { service, schedules } = harness(['2026-09-27', '2026-11-27']);
    schedules[1].installmentNo = 7;
    const result = await service.execute({ contractId: 'contract-1', fromInstallmentNo: 5, daysToShift: 14 });
    expect(Object.values(result.newDueDates).map(bkkDate)).toEqual(['2026-10-11', '2026-12-11']);
  });
});
