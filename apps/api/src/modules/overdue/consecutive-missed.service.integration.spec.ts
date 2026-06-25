import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { ConsecutiveMissedService } from './consecutive-missed.service';

const prisma = new PrismaClient();

/**
 * seedStandard17k12m creates installmentSchedule rows but NOT Payment rows.
 * We create 5 Payment rows explicitly so the `payments` table has data.
 * Then we set statuses so installments 2,3,4 are unpaid-overdue (a run of 3)
 * while 1 and 5 are PAID — expected streak = 3.
 */
async function seedPaymentsAndStreak(contractId: string, now: Date) {
  const past = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const amountDue = new Decimal('1515.83');

  // Create 5 payment rows
  for (let installmentNo = 1; installmentNo <= 5; installmentNo++) {
    // Determine status and dueDate based on installment number
    let status: 'PAID' | 'PENDING';
    let dueDate: Date;
    if ([2, 3, 4].includes(installmentNo)) {
      status = 'PENDING';
      // dueDate in the past (past due) — creates overdue installments
      // installmentNo=2 → past(25), =3 → past(45), =4 → past(65)
      dueDate = past(20 * (5 - installmentNo) + 5);
    } else {
      status = 'PAID';
      dueDate = past(90 + installmentNo * 30);
    }

    await prisma.payment.upsert({
      where: { contractId_installmentNo: { contractId, installmentNo } },
      create: {
        contractId,
        installmentNo,
        dueDate,
        amountDue,
        amountPaid: status === 'PAID' ? amountDue : new Decimal('0'),
        status,
      },
      update: {
        dueDate,
        status,
        amountPaid: status === 'PAID' ? amountDue : new Decimal('0'),
      },
    });
  }
}

describe('ConsecutiveMissedService.getStreaks', () => {
  let svc: ConsecutiveMissedService;
  let contractId: string;
  const now = new Date('2026-06-25T00:00:00Z');

  beforeAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'OVERDUE' } });
    await seedPaymentsAndStreak(contractId, now);
    svc = new ConsecutiveMissedService(prisma as any);
  });

  it('derives the longest unpaid-overdue run (paid installments break it)', async () => {
    const streaks = await svc.getStreaks({ contractIds: [contractId] }, now);
    expect(streaks.get(contractId)).toBe(3);
  });

  it('returns an empty map for an empty contractIds list (no query)', async () => {
    const streaks = await svc.getStreaks({ contractIds: [] }, now);
    expect(streaks.size).toBe(0);
  });
});
