import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { OverdueLifecycleCronService } from './overdue-lifecycle-cron.service';
import { ConsecutiveMissedService } from '../consecutive-missed.service';

const prisma = new PrismaClient();

/**
 * Seed Payment rows for the cron integration test.
 * Installments 1 and 2 are PENDING + past due (a run of 2 consecutive missed).
 * All other installments are PAID so they break no streak before/after.
 * The cron's OVERDUE→DEFAULT rule fires at streak >= 2, so this contract
 * should flip from OVERDUE to DEFAULT.
 */
async function seedPaymentsForCronTest(contractId: string, now: Date) {
  const past = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const amountDue = new Decimal('1515.83');

  for (let installmentNo = 1; installmentNo <= 5; installmentNo++) {
    let status: 'PAID' | 'PENDING';
    let dueDate: Date;

    if ([1, 2].includes(installmentNo)) {
      status = 'PENDING';
      // Due dates in the past so they are unpaid-overdue
      // installmentNo=1 → past(45), installmentNo=2 → past(25)
      dueDate = past(25 + (2 - installmentNo) * 20);
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

describe('OverdueLifecycleCronService — OVERDUE→DEFAULT flip via ConsecutiveMissedService', () => {
  let contractId: string;

  beforeAll(async () => {
    // Clean slate (auditLog is immutable — skip deleteMany, just clean payments/contracts)
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});

    // Ensure a system user exists (the cron calls getSystemUserIdOrThrow)
    const sysUser = await prisma.user.findFirst({ where: { isSystemUser: true } });
    if (!sysUser) {
      await prisma.user.create({
        data: {
          email: 'sys@bestchoice.com',
          password: 'x',
          name: 'sys',
          role: 'OWNER',
          isSystemUser: true,
        },
      });
    }

    const now = new Date();
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;

    // Put the contract in OVERDUE so the DEFAULT-flip step applies
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'OVERDUE' } });

    // Seed 2 consecutive unpaid-overdue payments (streak = 2 → triggers DEFAULT flip)
    await seedPaymentsForCronTest(contractId, now);
  });

  it('flips an OVERDUE contract with 2+ consecutive missed payments to DEFAULT', async () => {
    const svc = new OverdueLifecycleCronService(
      prisma as any,
      new ConsecutiveMissedService(prisma as any),
    );

    await svc.updateContractStatuses();

    const after = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(after!.status).toBe('DEFAULT');
  });
});
