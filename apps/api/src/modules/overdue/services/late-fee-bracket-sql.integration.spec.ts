/**
 * Anti-drift integration test: SQL calculateLateFees() == computeBracketLateFee() util
 *
 * Named *.integration.spec.ts so jest testPathIgnorePatterns skips it (CI runner = jest --runInBand).
 * Run with: npx vitest run --no-file-parallelism src/modules/overdue/services/late-fee-bracket-sql.integration.spec.ts
 *
 * CPA ยืนยันขั้นบันไดถาวร 2026-08-01 — BRACKET is the only late-fee formula in
 * the system now. (This spec used to be `late-fee-perday-sql.integration.spec.ts`
 * with a second describe block proving the PER_DAY SQL branch matched
 * `computePerDayLateFee`; PER_DAY was retired the same day the CPA confirmed
 * BRACKET permanently — it was CPA-gated and never actually ran on prod, which
 * always seeded `late_fee_mode=BRACKET`.) This is now the SOLE anti-drift
 * guard: the raw-SQL CASE expression inside `calculateLateFees()` must match
 * `computeBracketLateFee()` to the satang, across the tier1 / tier2-boundary /
 * flat-tier2 bands.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { OverdueLifecycleCronService } from './overdue-lifecycle-cron.service';
import { ConsecutiveMissedService } from '../consecutive-missed.service';
import { computeBracketLateFee, loadLateFeeConfig } from '../../../utils/late-fee.util';

const prisma = new PrismaClient();

// Four bands — tier1=50/tier2=100/minDays=3:
//   n=1  days=1   → tier1 (< minDays):            50
//   n=2  days=2   → tier1 (< minDays):             50
//   n=3  days=3   → tier2 (boundary, == minDays):  100
//   n=4  days=100 → tier2 (flat, does not grow):   100
const cases = [
  { n: 1, days: 1 },
  { n: 2, days: 2 },
  { n: 3, days: 3 },
  { n: 4, days: 100 },
];

const BRACKET_CONFIG = [
  ['late_fee_tier1_amount', '50'],
  ['late_fee_tier2_amount', '100'],
  ['late_fee_tier2_min_days', '3'],
] as const;

const CONFIG_KEYS = BRACKET_CONFIG.map(([key]) => key);

describe('calculateLateFees SQL == computeBracketLateFee (anti-drift)', () => {
  let contractId: string;

  beforeAll(async () => {
    // Clean slate for payments, installmentSchedules, contracts
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });

    // Set BRACKET config
    for (const [key, value] of BRACKET_CONFIG) {
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }

    // Seed a contract (creates installment schedules, NOT payments)
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;

    // Ensure contract is ACTIVE (it is by default, but be explicit)
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'ACTIVE' } });

    const now = Date.now();
    // Create PENDING payments with due dates in the past (days overdue = `days`)
    for (const { n, days } of cases) {
      await prisma.payment.create({
        data: {
          contractId,
          installmentNo: n,
          amountDue: new Prisma.Decimal('1515.83'),
          dueDate: new Date(now - days * 86_400_000),
          status: 'PENDING',
        } as any,
      });
    }
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
    await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS } } });
    await prisma.$disconnect();
  });

  it('every row SQL late_fee equals computeBracketLateFee (tier1, tier2-boundary, flat-tier2)', async () => {
    const svc = new OverdueLifecycleCronService(
      prisma as any,
      new ConsecutiveMissedService(prisma as any),
    );
    await svc.calculateLateFees();

    const cfg = await loadLateFeeConfig(prisma);
    expect(cfg.tier1Amount).toBe(50);
    expect(cfg.tier2Amount).toBe(100);
    expect(cfg.tier2MinDays).toBe(3);

    for (const { n, days } of cases) {
      const p = await prisma.payment.findFirst({ where: { contractId, installmentNo: n } });
      expect(p, `payment installmentNo=${n} should exist`).not.toBeNull();

      const expected = computeBracketLateFee({
        daysOverdue: days,
        tier1Amount: cfg.tier1Amount,
        tier2Amount: cfg.tier2Amount,
        tier2MinDays: cfg.tier2MinDays,
      });

      // SQL and util must agree to the satang
      expect(
        new Prisma.Decimal(p!.lateFee.toString()).toString(),
        `days=${days}: SQL late_fee vs util`,
      ).toBe(expected.toString());
    }

    // Explicit boundary + flat-tier assertions (parity with the pre-D2 flat-bracket implementation)
    const p3 = await prisma.payment.findFirst({ where: { contractId, installmentNo: 3 } });
    expect(new Prisma.Decimal(p3!.lateFee.toString()).toString()).toBe('100');
    const p4 = await prisma.payment.findFirst({ where: { contractId, installmentNo: 4 } });
    expect(new Prisma.Decimal(p4!.lateFee.toString()).toString()).toBe('100');
  });
});
