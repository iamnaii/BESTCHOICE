import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { BadDebtService } from './bad-debt.service';
import { ConsecutiveMissedService } from '../overdue/consecutive-missed.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { BadDebtProvisionTemplate } from '../journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';

const prisma = new PrismaClient();

function build() {
  const journal = new JournalAutoService(prisma as any);
  return new BadDebtService(
    prisma as any,
    journal,
    new BadDebtProvisionTemplate(journal, prisma as any),
    new BadDebtWriteOffTemplate(journal, prisma as any),
    new EclStageReverseTemplate(journal, prisma as any),
    new ConsecutiveMissedService(prisma as any),
  );
}

describe('calculateProvisions — streak floors a low-aging contract', () => {
  let contractId: string;

  beforeAll(async () => {
    await prisma.badDebtProvision.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    // Remove any DB override so DEFAULT_PROVISION_RATES (61-90 = 0.5) apply.
    await prisma.systemConfig.deleteMany({
      where: { key: { in: ['bad_debt_provision_rates', 'consecutive_missed_bucket_map'] } },
    });
    await seedFinanceCoa(prisma);
    if (!(await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } }))) {
      await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'a', role: 'OWNER' },
      });
    }
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'OVERDUE' } });

    // 3 consecutive unpaid-overdue installments, each only ~11-13 days overdue
    // → aging = B1 (1-30, 2%), streak = 3 → floor B3 (61-90, 50%).
    const now = Date.now();

    // Seed Payment rows directly (seedStandard17k12m creates only installmentSchedule rows).
    // Payment field shape mirrors consecutive-missed.service.spec.ts (upsert on contractId_installmentNo).
    for (let installmentNo = 1; installmentNo <= 5; installmentNo++) {
      const overdue = [1, 2, 3].includes(installmentNo);
      const dueDate = overdue
        ? new Date(now - (14 - installmentNo) * 86_400_000)
        : new Date(now + installmentNo * 86_400_000);

      await prisma.payment.upsert({
        where: { contractId_installmentNo: { contractId, installmentNo } },
        create: {
          contractId,
          installmentNo,
          amountDue: new Decimal('1515.83'),
          amountPaid: overdue ? new Decimal('0') : new Decimal('1515.83'),
          dueDate,
          status: overdue ? 'PARTIALLY_PAID' : 'PAID',
        },
        update: {
          amountDue: new Decimal('1515.83'),
          amountPaid: overdue ? new Decimal('0') : new Decimal('1515.83'),
          dueDate,
          status: overdue ? 'PARTIALLY_PAID' : 'PAID',
        },
      });
    }
  });

  it('provisions at the streak-floored bucket (B3 50%), not aging B1 (2%)', async () => {
    const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    await build().calculateProvisions(admin!.id);
    const row = await prisma.badDebtProvision.findFirst({
      where: { contractId, status: 'ACTIVE', deletedAt: null },
      orderBy: { provisionDate: 'desc' },
    });
    expect(row!.agingBucket).toBe('61-90');
    expect(Number(row!.provisionRate)).toBe(0.5);
  });
});
