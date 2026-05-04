import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../cpa-templates/installment-accrual-2a.template';
import { InstallmentAccrualCron } from './installment-accrual.cron';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

describe('InstallmentAccrualCron', () => {
  beforeAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);

    const systemEmail = 'admin@bestchoice.com';
    const existing = await prisma.user.findFirst({ where: { email: systemEmail } });
    if (!existing) {
      const anyBranch = await prisma.branch.findFirst({ where: { deletedAt: null } });
      let branchId = anyBranch?.id;
      if (!branchId) {
        const co = await prisma.companyInfo.findFirst({ where: { deletedAt: null } });
        let companyId = co?.id;
        if (!companyId) {
          const created = await prisma.companyInfo.create({
            data: {
              nameTh: 'System Co',
              taxId: '9999999999999',
              companyCode: 'SYSTEM',
              address: '1 System Rd',
              directorName: 'System',
              vatRegistered: false,
            },
          });
          companyId = created.id;
        }
        const b = await prisma.branch.create({ data: { name: '__system__', companyId } });
        branchId = b.id;
      }
      await prisma.user.create({
        data: {
          email: systemEmail,
          password: 'hashed_placeholder',
          name: 'Admin',
          role: 'OWNER',
          branchId,
        },
      });
    }
  });

  it('processes today-due installments and is idempotent', async () => {
    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);

    // Activate the contract (1A) to set up HP receivable
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Shift installment #1 due_date to today so the cron picks it up
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 1 },
    });
    await prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { dueDate: new Date() },
    });

    const cron = new InstallmentAccrualCron(
      prisma as any,
      new InstallmentAccrual2ATemplate(new JournalAutoService(prisma as any), prisma as any),
    );

    // First run — should process at least 1 installment
    const r1 = await cron.tick();
    expect(r1.processed).toBeGreaterThanOrEqual(1);
    expect(r1.failed).toBe(0);

    // Second run — installment already accrued, should skip (processed = 0)
    const r2 = await cron.tick();
    expect(r2.processed).toBe(0);
    expect(r2.failed).toBe(0);

    // Exactly 1 accrual JE for this contract (queried via metadata JSONB)
    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['contractId'], equals: c.id } },
    });
    const tag2A = entries.filter((e) => (e.metadata as any)?.tag === '2A');
    expect(tag2A.length).toBe(1);
  });
});
