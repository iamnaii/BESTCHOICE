import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { BadDebtProvisionTemplate } from './bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from './bad-debt-writeoff.template';
import { EclStageReverseTemplate } from './ecl-stage-reverse.template';
import { JournalAutoService } from '../journal-auto.service';
import { BadDebtService } from '../../accounting/bad-debt.service';
import { ConsecutiveMissedService } from '../../overdue/consecutive-missed.service';

const prisma = new PrismaClient();

function buildService(journal: JournalAutoService) {
  return new BadDebtService(
    prisma as any,
    journal,
    new BadDebtProvisionTemplate(journal, prisma as any),
    new BadDebtWriteOffTemplate(journal, prisma as any),
    new EclStageReverseTemplate(journal, prisma as any),
    new ConsecutiveMissedService(prisma as any),
  );
}

describe('ECL base for TERMINATED contract = GL carrying amount', () => {
  let journal: JournalAutoService;
  let contractId: string;
  let savedProvisionRatesConfig: { value: string; label: string | null } | null = null;

  beforeAll(async () => {
    // JournalPostAuditLog rows (asset flows) FK-reference journal_entries —
    // clear them first or deleteMany trips P2003 if an asset spec ran earlier
    // (same ledger note as bad-debt-writeoff.template.spec.ts).
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.badDebtProvision.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);

    // Golden values (12,797.51 / 9,598.13 / '91-180') assume DEFAULT_PROVISION_RATES
    // (91-180 → 75%). A local dev DB may carry a custom `bad_debt_provision_rates`
    // SystemConfig row (e.g. 91-180 → 50%) from unrelated seeding/testing — neutralize
    // it for the duration of this spec, then restore exactly what was there.
    savedProvisionRatesConfig = await prisma.systemConfig.findUnique({
      where: { key: 'bad_debt_provision_rates' },
    });
    if (savedProvisionRatesConfig) {
      await prisma.systemConfig.delete({ where: { key: 'bad_debt_provision_rates' } });
    }
    if (!(await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } }))) {
      await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'a', role: 'OWNER' },
      });
    }
    journal = new JournalAutoService(prisma as any);

    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contractId);

    // Accrue 3 งวดแรกผ่าน 2A จริง แล้ว mark เป็นค้างชำระ 100 วัน (B4)
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId },
      orderBy: { installmentNo: 'asc' },
      take: 3,
    });
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    for (const inst of insts) await accrual.execute(inst.id);

    const now = Date.now();
    for (let no = 1; no <= 3; no++) {
      await prisma.payment.upsert({
        where: { contractId_installmentNo: { contractId, installmentNo: no } },
        create: {
          contractId,
          installmentNo: no,
          amountDue: new Decimal('1515.83'),
          amountPaid: new Decimal('0'),
          dueDate: new Date(now - (100 + 3 - no) * 86_400_000),
          status: 'PENDING',
        },
        update: {},
      });
    }
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'TERMINATED' } });
  });

  afterAll(async () => {
    await prisma.badDebtProvision.deleteMany({ where: { contractId } });
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({ where: { contractId } });
    await prisma.installmentSchedule.deleteMany({ where: { contractId } });
    await prisma.contract.deleteMany({ where: { id: contractId } });
    // Restore whatever bad_debt_provision_rates SystemConfig this dev DB had
    // before the spec ran (neutralized in beforeAll).
    if (savedProvisionRatesConfig) {
      await prisma.systemConfig.upsert({
        where: { key: 'bad_debt_provision_rates' },
        create: {
          key: 'bad_debt_provision_rates',
          value: savedProvisionRatesConfig.value,
          label: savedProvisionRatesConfig.label,
        },
        update: { value: savedProvisionRatesConfig.value, label: savedProvisionRatesConfig.label },
      });
    }
    await prisma.$disconnect();
  });

  it('provisions B4 75% on carrying amount 12,797.51 → 9,598.13', async () => {
    const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    await buildService(journal).calculateProvisions(admin!.id);

    const row = await prisma.badDebtProvision.findFirst({
      where: { contractId, status: 'ACTIVE', deletedAt: null },
      orderBy: { provisionDate: 'desc' },
    });
    expect(row!.agingBucket).toBe('91-180');
    // carrying = 3×1,515.83 + (17,000 − 3×1,416.66) − (6,000 − 3×500)
    //          = 4,547.49 + 12,750.02 − 4,500.00 = 12,797.51
    expect(new Decimal(row!.outstandingAmount.toString()).toFixed(2)).toBe('12797.51');
    expect(new Decimal(row!.provisionAmount.toString()).toFixed(2)).toBe('9598.13');
  });
});
