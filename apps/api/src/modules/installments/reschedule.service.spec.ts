import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { RescheduleService } from './reschedule.service';

const prisma = new PrismaClient();

describe('RescheduleService', () => {
  beforeAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);
  });

  it('shifts due_date for installments >= fromInstallmentNo + reduces last installment by fee', async () => {
    const c = await seedStandard17k12m(prisma);
    const svc = new RescheduleService(prisma as any);
    const result = await svc.execute({
      contractId: c.id,
      fromInstallmentNo: 5,
      daysToShift: 16,
    });

    expect(result.rescheduleFee.toFixed(2)).toBe('808.44');

    const inst5 = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 5 },
    });
    // Original due was 2025-05-01 (startDate 2025-01-01 + 4 months = May 1); after +16 days = 2025-05-17
    const inst5DueStr = inst5.dueDate.toISOString().slice(0, 10);
    expect(inst5.rescheduledFromDate).not.toBeNull();
    expect(inst5.rescheduleCount).toBe(1);
    // Shifted by 16 days from original due
    const originalDue = inst5.rescheduledFromDate!;
    const expectedDue = new Date(originalDue);
    expectedDue.setDate(expectedDue.getDate() + 16);
    expect(inst5DueStr).toBe(expectedDue.toISOString().slice(0, 10));

    const inst12 = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 12 },
    });
    // monthlyPayment is 1515.84 (1416.67 + 99.17) - 808.44 = 707.40
    // Note: CSV uses 1515.83 but seeder rounds differently; actual DB value is 1515.84
    const inst12AmountDue = new Decimal((inst12.amountDue as any).toString());
    expect(inst12AmountDue.toFixed(2)).toBe('707.40');

    // Installments 5-12 should all be shifted
    const allShifted = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id, installmentNo: { gte: 5 } },
      orderBy: { installmentNo: 'asc' },
    });
    for (const inst of allShifted) {
      expect(inst.rescheduleCount).toBe(1);
      expect(inst.rescheduledFromDate).not.toBeNull();
    }

    // Installments 1-4 should NOT be shifted
    const unshifted = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id, installmentNo: { lt: 5 } },
      orderBy: { installmentNo: 'asc' },
    });
    for (const inst of unshifted) {
      expect(inst.rescheduleCount).toBe(0);
      expect(inst.rescheduledFromDate).toBeNull();
    }
  });
});
