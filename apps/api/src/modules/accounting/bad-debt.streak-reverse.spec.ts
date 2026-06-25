import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
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
    prisma as any, journal,
    new BadDebtProvisionTemplate(journal, prisma as any),
    new BadDebtWriteOffTemplate(journal, prisma as any),
    new EclStageReverseTemplate(journal, prisma as any),
    new ConsecutiveMissedService(prisma as any),
  );
}

describe('reverseStageOnPayment honours the streak floor (no over-release)', () => {
  let contractId: string;
  let svc: BadDebtService;

  beforeAll(async () => {
    await prisma.badDebtProvision.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);
    if (!(await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } }))) {
      await prisma.user.create({ data: { email: 'admin@bestchoice.com', password: 'x', name: 'a', role: 'OWNER' } });
    }
    svc = build();
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'OVERDUE' } });
    const now = Date.now();
    // installments 1,2 unpaid-overdue ~10-11 days (aging B1), streak 2 -> floor B2; rest PAID/future.
    for (let n = 1; n <= 5; n++) {
      const overdue = [1, 2].includes(n);
      await prisma.payment.create({
        data: {
          contractId, installmentNo: n, amountDue: '1515.83',
          dueDate: overdue ? new Date(now - (11 - n) * 86_400_000) : new Date(now + n * 86_400_000),
          status: overdue ? 'PARTIALLY_PAID' : 'PAID',
        } as any,
      });
    }
    const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    await svc.calculateProvisions(admin!.id);
  });

  afterAll(async () => {
    await prisma.badDebtProvision.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.$disconnect();
  });

  it('provisioned at the streak floor B2', async () => {
    const p = await prisma.badDebtProvision.findFirst({ where: { contractId, status: 'ACTIVE', deletedAt: null } });
    expect(p!.agingBucket).toBe('31-60');
  });

  it('reverse returns null — aging alone is B1 but the streak floor keeps B2', async () => {
    const result = await svc.reverseStageOnPayment(contractId);
    expect(result).toBeNull();
  });
});
