import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
    undefined as any, // CreditNoteDocumentService — unused (this spec never calls writeOffBadDebt)
    undefined as any, // CreditNoteDeliveryService — unused (this spec never calls writeOffBadDebt)
  );
}

// 2026-07-26 per-installment plan: the streak floor is DORMANT by default —
// an empty/missing `consecutive_missed_bucket_map` SystemConfig means NO
// floor at all (the old code-default fallback is retired). This spec now
// explicitly SEEDS that config row so it continues to exercise the
// floor-ENABLED path, plus adds a no-config case proving aging-only applies
// when the row is absent.
const STREAK_MAP_JSON = JSON.stringify({ '2': '31-60', '3': '61-90', '4': '91-180', '5': '180+' });

describe('calculateProvisions — streak floors a low-aging contract', () => {
  let contractId: string;
  let savedStreakMapConfig: { value: string; label: string | null } | null = null;

  afterAll(async () => {
    // Restore (or remove) the consecutive_missed_bucket_map row FIRST — same
    // crash-safety ordering as ecl-terminated-base.spec.ts.
    if (savedStreakMapConfig) {
      await prisma.systemConfig.update({
        where: { key: 'consecutive_missed_bucket_map' },
        data: { value: savedStreakMapConfig.value, label: savedStreakMapConfig.label },
      });
    } else {
      await prisma.systemConfig.deleteMany({ where: { key: 'consecutive_missed_bucket_map' } });
    }

    await prisma.badDebtProvision.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
    await prisma.$disconnect();
  });

  beforeAll(async () => {
    await prisma.badDebtProvision.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
    await seedFinanceCoa(prisma);

    // Capture + upsert (never delete) — crash-safe, mirrors
    // ecl-terminated-base.spec.ts's bad_debt_provision_rates handling.
    savedStreakMapConfig = await prisma.systemConfig.findUnique({
      where: { key: 'consecutive_missed_bucket_map' },
    });
    await prisma.systemConfig.upsert({
      where: { key: 'consecutive_missed_bucket_map' },
      create: { key: 'consecutive_missed_bucket_map', value: STREAK_MAP_JSON },
      update: { value: STREAK_MAP_JSON },
    });

    if (!(await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } }))) {
      await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'a', role: 'OWNER' },
      });
    }
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'OVERDUE' } });

    // 3 consecutive unpaid-overdue installments, each only ~11-13 days overdue
    // → per-installment aging = B1 (1-30, 2%) each, streak = 3 → floor B3
    // (61-90, 50%) applied to EACH of the 3 rows (higher rate wins per row).
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

  it('provisions at the streak-floored bucket (B3 50%), not aging B1 (2%) — per-installment, floor ENABLED', async () => {
    const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    await build().calculateProvisions(admin!.id);
    const row = await prisma.badDebtProvision.findFirst({
      where: { contractId, status: 'ACTIVE', deletedAt: null },
      orderBy: { provisionDate: 'desc' },
    });
    expect(row!.agingBucket).toBe('61-90');
    // All 3 installments floored to B3 (50%): 3 × (1,515.83 × 0.50 rounded
    // 757.915 → 757.92) = 2,273.76 — proves the floor applies PER
    // INSTALLMENT (not just to a single whole-contract bucket).
    expect(Number(row!.provisionAmount)).toBeCloseTo(2273.76, 2);
  });

  it('no consecutive_missed_bucket_map row → floor OFF, aging-only per installment (2026-07-26 dormant-by-default)', async () => {
    // Remove the config seeded above for this one assertion, then restore it
    // immediately after so the describe-level afterAll's restore logic still
    // sees the ORIGINAL pre-suite value (not this test's temporary removal).
    await prisma.systemConfig.deleteMany({ where: { key: 'consecutive_missed_bucket_map' } });
    try {
      const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
      await build().calculateProvisions(admin!.id);
      const row = await prisma.badDebtProvision.findFirst({
        where: { contractId, status: 'ACTIVE', deletedAt: null },
        orderBy: { provisionDate: 'desc' },
      });
      // No floor → aging alone: all 3 installments are ~11-13 days overdue →
      // bucket 1-30 (2%) → 3 × 30.32 (1,515.83 × 0.02 = 30.3166 → 30.32) = 90.96
      expect(row!.agingBucket).toBe('1-30');
      expect(Number(row!.provisionAmount)).toBeCloseTo(90.96, 2);
    } finally {
      await prisma.systemConfig.upsert({
        where: { key: 'consecutive_missed_bucket_map' },
        create: { key: 'consecutive_missed_bucket_map', value: STREAK_MAP_JSON },
        update: { value: STREAK_MAP_JSON },
      });
    }
  });
});
