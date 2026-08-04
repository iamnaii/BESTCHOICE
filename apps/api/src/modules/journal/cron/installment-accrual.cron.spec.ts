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
    // JournalPostAuditLog rows (asset flows) FK-reference journal_entries — clear
    // them first or this deleteMany trips P2003 when an asset spec ran earlier.
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
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

    // scenario-helpers.seedStandard17k12m hardcodes startDate=2025-01-01, so
    // installments #2-12 (Mar 2025 – Jan 2026) drift into the past as real
    // wall-clock time advances past that window. The cron's backfill query
    // (dueDate < tomorrow) then sweeps them up too, breaking this test's
    // "only installment #1 is due" assumption — pin them safely in the future
    // so this assertion stays isolated to installment #1 regardless of when
    // the suite runs.
    await prisma.installmentSchedule.updateMany({
      where: { contractId: c.id, installmentNo: { gt: 1 } },
      data: { dueDate: new Date(Date.now() + 365 * 86_400_000) },
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

  it('backfills past-due installments missed by previous runs', async () => {
    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);

    // Activate the contract (1A) to set up HP receivable
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Shift installment #1 due_date to 7 days ago — simulates a missed run
    // (cron skipped, contract created with backdated due, or legacy import).
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 1 },
    });
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    await prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { dueDate: sevenDaysAgo, accrualJournalEntryId: null },
    });

    const cron = new InstallmentAccrualCron(
      prisma as any,
      new InstallmentAccrual2ATemplate(new JournalAutoService(prisma as any), prisma as any),
    );

    const result = await cron.tick();
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    // The accrued installment should now have an accrualJournalEntryId
    const after = await prisma.installmentSchedule.findFirstOrThrow({
      where: { id: inst.id },
    });
    expect(after.accrualJournalEntryId).not.toBeNull();

    // The accrual JE postedAt should match the original (past) dueDate,
    // not the cron run date — so the accounting period is correct.
    const accrualJe = await prisma.journalEntry.findFirstOrThrow({
      where: { entryNumber: after.accrualJournalEntryId! },
    });
    expect(accrualJe.postedAt).not.toBeNull();
    // Compare date-only to avoid Postgres timestamp precision flakes; both
    // values are seeded with setHours(0,0,0,0) so day equality is sufficient.
    expect(accrualJe.postedAt!.toDateString()).toBe(sevenDaysAgo.toDateString());
  });
});
