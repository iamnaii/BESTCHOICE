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
    undefined as any, // CreditNoteDocumentService — unused (this spec never calls writeOffBadDebt)
    undefined as any, // CreditNoteDeliveryService — unused (this spec never calls writeOffBadDebt)
  );
}

// 2026-07-26 per-installment plan: the streak floor is DORMANT by default —
// this spec must explicitly SEED `consecutive_missed_bucket_map` (crash-safe
// capture/restore, mirrors ecl-terminated-base.spec.ts) to keep exercising
// the floor-ENABLED path; the old behaviour of relying on an unseeded code
// default no longer applies.
const STREAK_MAP_JSON = JSON.stringify({ '2': '31-60', '3': '61-90', '4': '91-180', '5': '180+' });

describe('reverseStageOnPayment honours the streak floor (no over-release)', () => {
  let contractId: string;
  let svc: BadDebtService;
  let savedStreakMapConfig: { value: string; label: string | null } | null = null;

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

    savedStreakMapConfig = await prisma.systemConfig.findUnique({
      where: { key: 'consecutive_missed_bucket_map' },
    });
    await prisma.systemConfig.upsert({
      where: { key: 'consecutive_missed_bucket_map' },
      create: { key: 'consecutive_missed_bucket_map', value: STREAK_MAP_JSON },
      update: { value: STREAK_MAP_JSON },
    });

    if (!(await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } }))) {
      await prisma.user.create({ data: { email: 'admin@bestchoice.com', password: 'x', name: 'a', role: 'OWNER' } });
    }
    svc = build();
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'OVERDUE' } });
    const now = Date.now();
    // installments 1,2 unpaid-overdue ~10-11 days (aging B1 per-installment),
    // streak 2 -> floor B2; rest PAID/future.
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
    // Restore (or remove) the config row FIRST — crash-safety ordering.
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

  it('provisioned at the streak floor B2 — both installments floored (2 × 227.37 = 454.74)', async () => {
    const p = await prisma.badDebtProvision.findFirst({ where: { contractId, status: 'ACTIVE', deletedAt: null } });
    expect(p!.agingBucket).toBe('31-60');
    // 1,515.83 × 0.15 = 227.3745 → 227.37 per installment, × 2 rows = 454.74
    expect(Number(p!.provisionAmount)).toBeCloseTo(454.74, 2);
  });

  it('reverse returns null — aging alone is B1 but the streak floor keeps B2', async () => {
    const result = await svc.reverseStageOnPayment(contractId);
    expect(result).toBeNull();
  });
});
