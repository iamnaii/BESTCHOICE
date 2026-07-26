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

// Mirrors DEFAULT_PROVISION_RATES in bad-debt.service.ts (not exported — keep in
// sync manually). Golden values in this spec assume these rates.
const DEFAULT_PROVISION_RATES_JSON = JSON.stringify({
  '1-30': 0.02,
  '31-60': 0.15,
  '61-90': 0.5,
  '91-180': 0.75,
  '180+': 1.0,
});

function buildService(journal: JournalAutoService) {
  return new BadDebtService(
    prisma as any,
    journal,
    new BadDebtProvisionTemplate(journal, prisma as any),
    new BadDebtWriteOffTemplate(journal, prisma as any),
    new EclStageReverseTemplate(journal, prisma as any),
    new ConsecutiveMissedService(prisma as any),
    undefined as any, // CreditNoteDocumentService — unused (this spec never calls writeOffBadDebt)
    undefined as any, // CreditNoteDeliveryService — unused (this spec never calls writeOffBadDebt)
  );
}

/**
 * 2026-07-26 Task 4 rewrite: the old carrying-amount base
 * (`terminatedCarryingAmount`, reading 11-2103/11-2101/11-2106 GL balances)
 * is retired entirely. A TERMINATED contract's ECL base is now the SAME
 * per-installment engine `calculateProvisions` uses for ACTIVE contracts —
 * each outstanding installment ages independently off its own
 * `Payment.dueDate`, gets its own bucket/rate, and the contract's provision
 * is the SUM of those per-installment provisions (not one whole-contract
 * bucket keyed off the oldest installment).
 *
 * Golden (17k/12m fixture, installmentTotal 1,515.83 — see
 * .claude/rules/accounting.md rounding table): 3 accrued-unpaid installments
 * aged 100/70/40 days →
 *   100d → 91-180 (75%) → 1,515.83 × 0.75 = 1,136.8725 → 1,136.87
 *    70d → 61-90  (50%) → 1,515.83 × 0.50 =   757.915  →   757.92
 *    40d → 31-60  (15%) → 1,515.83 × 0.15 =   227.3745 →   227.37
 *   total provision = 1,136.87 + 757.92 + 227.37 = 2,122.16
 *   outstandingAmount = 3 × 1,515.83 = 4,547.49
 *   agingBucket (display, spec §2.3) = bucket of the OLDEST installment
 *     (100d) = '91-180'
 *   bucketBreakdown has 3 distinct buckets (one row each)
 */
describe('ECL base for TERMINATED contract = per-installment aging (SAME as ACTIVE, carrying-amount base retired)', () => {
  let journal: JournalAutoService;
  let contractId: string;
  let savedProvisionRatesConfig: { value: string; label: string | null } | null = null;
  let savedStreakMapConfig: { value: string; label: string | null } | null = null;

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
    // T1-C7 guard: a contract that went through a real writeOffBadDebt() has a
    // permanent (DB-trigger-immutable) badDebtWriteOffAuditLog row FK-referencing
    // it — an unscoped deleteMany would throw once one exists in this shared
    // dev/CI DB (see cn-issue-on-writeoff.spec.ts, Phase 3 Task 3).
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
    await seedFinanceCoa(prisma);

    // Golden values assume DEFAULT_PROVISION_RATES (91-180 → 75%, 61-90 → 50%,
    // 31-60 → 15%). A local dev DB may carry a custom `bad_debt_provision_rates`
    // SystemConfig row from unrelated seeding/testing.
    //
    // Crash-safety (review round 2, carried over): capture the original row
    // (if any), then UPSERT its value to the code-default rates JSON — never
    // delete. If the process dies mid-run, the row is left holding correct
    // default rates (safe), not missing entirely. Restored to its exact
    // original value in afterAll (first statements, before any cleanup that
    // could throw and skip it).
    savedProvisionRatesConfig = await prisma.systemConfig.findUnique({
      where: { key: 'bad_debt_provision_rates' },
    });
    await prisma.systemConfig.upsert({
      where: { key: 'bad_debt_provision_rates' },
      create: { key: 'bad_debt_provision_rates', value: DEFAULT_PROVISION_RATES_JSON },
      update: { value: DEFAULT_PROVISION_RATES_JSON },
    });

    // 2026-07-26 semantics (spec §2.2): the streak floor is DORMANT unless an
    // explicit non-empty `consecutive_missed_bucket_map` row exists. This
    // golden is aging-only (no floor), so the row must be ABSENT for the
    // duration of the test — capture whatever exists first (crash-safe
    // restore in afterAll), then delete it.
    savedStreakMapConfig = await prisma.systemConfig.findUnique({
      where: { key: 'consecutive_missed_bucket_map' },
    });
    await prisma.systemConfig.deleteMany({ where: { key: 'consecutive_missed_bucket_map' } });

    if (!(await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } }))) {
      await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'a', role: 'OWNER' },
      });
    }
    journal = new JournalAutoService(prisma as any);

    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contractId);

    // Accrue the first 3 installments via a real 2A run, then mark them
    // overdue at 3 DIFFERENT ages (100/70/40 days) — per-installment aging,
    // not one whole-contract bucket.
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId },
      orderBy: { installmentNo: 'asc' },
      take: 3,
    });
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    for (const inst of insts) await accrual.execute(inst.id);

    const now = Date.now();
    const agesDays = [100, 70, 40];
    for (let i = 0; i < 3; i++) {
      const no = i + 1;
      await prisma.payment.upsert({
        where: { contractId_installmentNo: { contractId, installmentNo: no } },
        create: {
          contractId,
          installmentNo: no,
          amountDue: new Decimal('1515.83'),
          amountPaid: new Decimal('0'),
          dueDate: new Date(now - agesDays[i] * 86_400_000),
          status: 'PENDING',
        },
        update: {},
      });
    }
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'TERMINATED' } });
  });

  afterAll(async () => {
    // FIRST statements — restore whatever this dev DB had before the spec
    // ran, before any cleanup below gets a chance to throw and skip it
    // (review round 2 crash-safety fix, carried over to both configs).
    if (savedProvisionRatesConfig) {
      await prisma.systemConfig.update({
        where: { key: 'bad_debt_provision_rates' },
        data: {
          value: savedProvisionRatesConfig.value,
          label: savedProvisionRatesConfig.label,
        },
      });
    } else {
      await prisma.systemConfig.deleteMany({ where: { key: 'bad_debt_provision_rates' } });
    }
    if (savedStreakMapConfig) {
      await prisma.systemConfig.upsert({
        where: { key: 'consecutive_missed_bucket_map' },
        create: {
          key: 'consecutive_missed_bucket_map',
          value: savedStreakMapConfig.value,
          label: savedStreakMapConfig.label,
        },
        update: {
          value: savedStreakMapConfig.value,
          label: savedStreakMapConfig.label,
        },
      });
    } else {
      await prisma.systemConfig.deleteMany({ where: { key: 'consecutive_missed_bucket_map' } });
    }

    // Scoped to this spec's own contractId only — do NOT touch journal_entries/
    // journal_lines/journal_post_audit_log here. Those are unscoped tables shared
    // across specs; the beforeAll wipe convention (see above) already guarantees
    // each spec a clean slate, matching the sibling bad-debt-writeoff.template.spec.ts
    // pattern. Deleting them here with no `where` can erase a concurrently-running
    // spec's fixture data under parallel vitest workers (review round 2 fix).
    await prisma.badDebtProvision.deleteMany({ where: { contractId } });
    await prisma.payment.deleteMany({ where: { contractId } });
    await prisma.installmentSchedule.deleteMany({ where: { contractId } });
    await prisma.contract.deleteMany({ where: { id: contractId } });
    await prisma.$disconnect();
  });

  it('provisions per-installment (100d 75% + 70d 50% + 40d 15%) → 2,122.16, oldest bucket 91-180', async () => {
    const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    await buildService(journal).calculateProvisions(admin!.id);

    const row = await prisma.badDebtProvision.findFirst({
      where: { contractId, status: 'ACTIVE', deletedAt: null },
      orderBy: { provisionDate: 'desc' },
    });
    // agingBucket = bucket of the OLDEST installment (100d → 91-180) — display
    // convention only, does NOT mean the whole balance provisions at 75%.
    expect(row!.agingBucket).toBe('91-180');
    // outstandingAmount = 3 × 1,515.83 (no fee, no partial payment on any row)
    expect(new Decimal(row!.outstandingAmount.toString()).toFixed(2)).toBe('4547.49');
    // 1,136.87 + 757.92 + 227.37 = 2,122.16
    expect(new Decimal(row!.provisionAmount.toString()).toFixed(2)).toBe('2122.16');

    const breakdown = row!.bucketBreakdown as Record<
      string,
      { count: number; base: string; provision: string }
    >;
    expect(Object.keys(breakdown).sort()).toEqual(['31-60', '61-90', '91-180']);
    expect(breakdown['91-180']).toEqual({ count: 1, base: '1515.83', provision: '1136.87' });
    expect(breakdown['61-90']).toEqual({ count: 1, base: '1515.83', provision: '757.92' });
    expect(breakdown['31-60']).toEqual({ count: 1, base: '1515.83', provision: '227.37' });
  });
});
