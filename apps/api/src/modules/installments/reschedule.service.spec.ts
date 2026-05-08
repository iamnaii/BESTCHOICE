import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { RescheduleService } from './reschedule.service';

const prisma = new PrismaClient();

async function ensureRescheduleTestUser(): Promise<string> {
  const email = 'reschedule-tester@bestchoice-test.internal';
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      email,
      password: 'hashed_placeholder',
      name: 'Reschedule Tester',
      role: 'OWNER',
    },
  });
  return created.id;
}

async function cleanContractsAndJournal() {
  // audit_logs is immutable (T2-C4 trigger blocks DELETE) — we scope each
  // test by contract.id so no inter-test cleanup is needed for the audit table.
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.contract.deleteMany({});
}

describe('RescheduleService', () => {
  beforeAll(async () => {
    await cleanContractsAndJournal();
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
    expect(result.shiftedInstallmentIds.length).toBe(8); // installments 5..12

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

    // Without userId — no AuditLog row created (backward-compat path)
    const auditCount = await prisma.auditLog.count({
      where: { entityId: c.id, action: 'RESCHEDULE' },
    });
    expect(auditCount).toBe(0);
  });

  it('writes AuditLog action=RESCHEDULE inside the transaction when userId provided (Wave 2 Task 4)', async () => {
    await cleanContractsAndJournal();

    const c = await seedStandard17k12m(prisma);
    const userId = await ensureRescheduleTestUser();
    const svc = new RescheduleService(prisma as any);

    await svc.execute({
      contractId: c.id,
      fromInstallmentNo: 5,
      daysToShift: 16,
      userId,
      variant: '6a',
    });

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'contract', entityId: c.id, action: 'RESCHEDULE' },
    });
    expect(audits.length).toBe(1);
    const meta = audits[0].newValue as any;
    expect(meta.fromInstallmentNo).toBe(5);
    expect(meta.daysToShift).toBe(16);
    expect(meta.variant).toBe('6a');
    expect(meta.rescheduleFee).toBe('808.44');
    expect(meta.shiftedInstallmentCount).toBe(8);
    expect(meta.firstShiftedInstallmentNo).toBe(5);
    expect(audits[0].userId).toBe(userId);
  });

  it('rolls back due_date AND skips AuditLog when transaction throws (atomicity)', async () => {
    await cleanContractsAndJournal();

    const c = await seedStandard17k12m(prisma);
    const userId = await ensureRescheduleTestUser();
    const svc = new RescheduleService(prisma as any);

    // Force a transaction failure by passing a non-existent userId — FK violation
    // on AuditLog.userId → User.id will abort the transaction and roll back the
    // due_date updates AND the audit row.
    await expect(
      svc.execute({
        contractId: c.id,
        fromInstallmentNo: 5,
        daysToShift: 16,
        userId: '00000000-0000-0000-0000-000000000000',
        variant: '6a',
      }),
    ).rejects.toThrow();

    // Installment 5 dueDate must be unchanged (rollback worked)
    const inst5 = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 5 },
    });
    expect(inst5.rescheduleCount).toBe(0);
    expect(inst5.rescheduledFromDate).toBeNull();

    // No audit row leaked
    const audits = await prisma.auditLog.findMany({
      where: { entity: 'contract', entityId: c.id, action: 'RESCHEDULE' },
    });
    expect(audits.length).toBe(0);

    // Sanity: a follow-up correct call must still succeed
    await svc.execute({
      contractId: c.id,
      fromInstallmentNo: 5,
      daysToShift: 16,
      userId,
      variant: '6b',
    });
    const inst5after = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 5 },
    });
    expect(inst5after.rescheduleCount).toBe(1);
  });
});
