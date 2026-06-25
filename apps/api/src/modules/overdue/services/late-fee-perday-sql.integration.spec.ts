/**
 * Anti-drift integration test: SQL calculateLateFees() == computePerDayLateFee() util
 *
 * Named *.integration.spec.ts so jest testPathIgnorePatterns skips it (CI runner = jest --runInBand).
 * Run with: npx vitest run --no-file-parallelism src/modules/overdue/services/late-fee-perday-sql.integration.spec.ts
 *
 * Exit criterion for Task 3: SQL result must equal util result to the satang
 * for rows across ALL binding bands: per-day-binding, 5%-binding, max-binding.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { OverdueLifecycleCronService } from './overdue-lifecycle-cron.service';
import { ConsecutiveMissedService } from '../consecutive-missed.service';
import { computePerDayLateFee, loadLateFeeConfig } from '../../../utils/late-fee.util';

const prisma = new PrismaClient();

// Four bands — rate=20/max=500/cap=5%:
//   n=1  days=2   amountDue=1515.83 → byDay=40   < byPct=75.79  < max=500  → per-day-binding:   40
//   n=2  days=10  amountDue=1515.83 → byDay=200  > byPct=75.79  < max=500  → 5%-cap-binding:    75.79
//   n=3  days=40  amountDue=1515.83 → byDay=800  > byPct=75.79  > max=500  → 5%-cap-binding:    75.79
//   n=4  days=30  amountDue=20000   → byDay=600  > max=500; byPct=1000 > max=500 → max-binding: 500
const cases = [
  { n: 1, days: 2,  amountDue: '1515.83' }, // per-day-binding: 40
  { n: 2, days: 10, amountDue: '1515.83' }, // 5%-cap-binding:  75.79
  { n: 3, days: 40, amountDue: '1515.83' }, // 5%-cap-binding (max also > 75.79): 75.79
  { n: 4, days: 30, amountDue: '20000.00' }, // max-binding: byDay=600 >500; byPct=1000 >500 → 500
];

const PER_DAY_CONFIG = [
  ['late_fee_mode', 'PER_DAY'],
  ['late_fee_per_day_rate', '20'],
  ['late_fee_max_amount', '500'],
  ['late_fee_cap_pct', '5'],
] as const;

const CONFIG_KEYS = PER_DAY_CONFIG.map(([key]) => key);

describe('calculateLateFees PER_DAY SQL == computePerDayLateFee (anti-drift)', () => {
  let contractId: string;

  beforeAll(async () => {
    // Clean slate for payments, installmentSchedules, contracts
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});

    // Set PER_DAY config
    for (const [key, value] of PER_DAY_CONFIG) {
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }

    // Seed a contract (creates installment schedules, NOT payments)
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;

    // Ensure contract is ACTIVE (it is by default, but be explicit)
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'ACTIVE' } });

    const now = Date.now();
    // Create PENDING payments with due dates in the past (days overdue = `days`)
    for (const { n, days, amountDue } of cases) {
      await prisma.payment.create({
        data: {
          contractId,
          installmentNo: n,
          amountDue: new Prisma.Decimal(amountDue),
          dueDate: new Date(now - days * 86_400_000),
          status: 'PENDING',
        } as any,
      });
    }
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS } } });
    await prisma.$disconnect();
  });

  it('every row SQL late_fee equals computePerDayLateFee (per-day-binding, 5%-cap-binding, max-binding)', async () => {
    const svc = new OverdueLifecycleCronService(
      prisma as any,
      new ConsecutiveMissedService(prisma as any),
    );
    await svc.calculateLateFees();

    const cfg = await loadLateFeeConfig(prisma);
    expect(cfg.mode).toBe('PER_DAY');

    for (const { n, days, amountDue } of cases) {
      const p = await prisma.payment.findFirst({ where: { contractId, installmentNo: n } });
      expect(p, `payment installmentNo=${n} should exist`).not.toBeNull();

      const expected = computePerDayLateFee({
        daysOverdue: days,
        perDayRate: cfg.perDayRate,
        maxAmount: cfg.maxAmount,
        capPct: cfg.capPct,
        installmentGross: amountDue,
      });

      // SQL and util must agree to the satang
      expect(
        new Prisma.Decimal(p!.lateFee.toString()).toString(),
        `Band days=${days} amountDue=${amountDue}: SQL late_fee vs util`,
      ).toBe(expected.toString());
    }

    // Explicit max-binding assertion: n=4 days=30 amountDue=20000 must yield exactly 500
    const pMax = await prisma.payment.findFirst({ where: { contractId, installmentNo: 4 } });
    expect(new Prisma.Decimal(pMax!.lateFee.toString()).toString()).toBe('500');
  });
});

describe('calculateLateFees BRACKET SQL == flat bracket (parity / rollback guard)', () => {
  let contractId: string;
  const BRACKET_CONFIG = [
    ['late_fee_mode', 'BRACKET'],
    ['late_fee_tier1_amount', '50'],
    ['late_fee_tier2_amount', '100'],
    ['late_fee_tier2_min_days', '3'],
  ] as const;
  const BRACKET_KEYS = BRACKET_CONFIG.map(([key]) => key);

  beforeAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});

    // Set BRACKET config (also remove PER_DAY keys if present)
    await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS } } });
    for (const [key, value] of BRACKET_CONFIG) {
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }

    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'ACTIVE' } });

    // 10-day-overdue row → should hit tier2 (100) under BRACKET
    const now = Date.now();
    await prisma.payment.create({
      data: {
        contractId,
        installmentNo: 1,
        amountDue: new Prisma.Decimal('1515.83'),
        dueDate: new Date(now - 10 * 86_400_000),
        status: 'PENDING',
      } as any,
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.systemConfig.deleteMany({ where: { key: { in: BRACKET_KEYS } } });
    await prisma.$disconnect();
  });

  it('10-day-overdue row → tier2 = 100 (BRACKET rollback parity)', async () => {
    const svc = new OverdueLifecycleCronService(
      prisma as any,
      new ConsecutiveMissedService(prisma as any),
    );
    await svc.calculateLateFees();

    const p = await prisma.payment.findFirst({ where: { contractId, installmentNo: 1 } });
    expect(p, 'payment should exist').not.toBeNull();
    // BRACKET mode: 10 days >= tier2MinDays (3) → tier2Amount = 100
    expect(new Prisma.Decimal(p!.lateFee.toString()).toString()).toBe('100');
  });
});
