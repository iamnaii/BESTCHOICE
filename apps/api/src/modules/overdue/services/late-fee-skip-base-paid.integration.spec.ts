/**
 * Regression: calculateLateFees() must NOT touch installments whose base is
 * already paid (amountPaid >= amountDue).
 *
 * Bug: the bulk UPDATE recomputed late_fee from amount_due and flipped status to
 * OVERDUE for ANY overdue PENDING/PARTIALLY_PAID/OVERDUE row — including rows where
 * the customer already paid the full base and only the (frozen) late fee remained.
 * That resurrected/overwrote the late fee after a base payment.
 *
 * Named *.integration.spec.ts so jest testPathIgnorePatterns skips it (CI runner = jest).
 * Run with: npx vitest run --no-file-parallelism \
 *   src/modules/overdue/services/late-fee-skip-base-paid.integration.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { OverdueLifecycleCronService } from './overdue-lifecycle-cron.service';
import { ConsecutiveMissedService } from '../consecutive-missed.service';

const prisma = new PrismaClient();

const BRACKET_CONFIG = [
  ['late_fee_mode', 'BRACKET'],
  ['late_fee_tier1_amount', '50'],
  ['late_fee_tier2_amount', '100'],
  ['late_fee_tier2_min_days', '3'],
] as const;
const KEYS = BRACKET_CONFIG.map(([k]) => k);

describe('calculateLateFees skips installments whose base is already paid', () => {
  let contractId: string;

  beforeAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.systemConfig.deleteMany({ where: { key: { in: KEYS } } });
    for (const [key, value] of BRACKET_CONFIG) {
      await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }

    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'ACTIVE' } });

    const now = Date.now();
    // Row 1 — base fully paid (amountPaid == amountDue); only the late fee remains.
    // Preset lateFee = 77 (a value the BRACKET formula would NOT produce) so an
    // unwanted overwrite is detectable.
    await prisma.payment.create({
      data: {
        contractId,
        installmentNo: 1,
        amountDue: new Prisma.Decimal('3671.00'),
        amountPaid: new Prisma.Decimal('3671.00'),
        lateFee: new Prisma.Decimal('77.00'),
        dueDate: new Date(now - 10 * 86_400_000),
        status: 'PARTIALLY_PAID',
      } as any,
    });
    // Row 2 — control: unpaid + overdue → cron SHOULD apply the late fee.
    await prisma.payment.create({
      data: {
        contractId,
        installmentNo: 2,
        amountDue: new Prisma.Decimal('3671.00'),
        amountPaid: new Prisma.Decimal('0'),
        dueDate: new Date(now - 10 * 86_400_000),
        status: 'PENDING',
      } as any,
    });
    // Row 3 — PARTIAL principal (0 < amountPaid < amountDue): the base is NOT settled,
    // so the `amount_paid < amount_due` guard must NOT skip it — the cron SHOULD still
    // recompute the fee + flip OVERDUE. Preset lateFee = 77 (not a BRACKET output) so a
    // recompute is detectable. Pins the strict-'<' boundary from the paid side.
    await prisma.payment.create({
      data: {
        contractId,
        installmentNo: 3,
        amountDue: new Prisma.Decimal('3671.00'),
        amountPaid: new Prisma.Decimal('2000.00'),
        lateFee: new Prisma.Decimal('77.00'),
        dueDate: new Date(now - 10 * 86_400_000),
        status: 'PARTIALLY_PAID',
      } as any,
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.systemConfig.deleteMany({ where: { key: { in: KEYS } } });
    await prisma.$disconnect();
  });

  it('leaves late_fee + status untouched when amountPaid >= amountDue, but still updates unpaid rows', async () => {
    const svc = new OverdueLifecycleCronService(
      prisma as any,
      new ConsecutiveMissedService(prisma as any),
    );
    await svc.calculateLateFees();

    // Row 1 — base already paid: late fee frozen, status NOT flipped to OVERDUE
    const basePaid = await prisma.payment.findFirst({ where: { contractId, installmentNo: 1 } });
    expect(new Prisma.Decimal(basePaid!.lateFee.toString()).toString()).toBe('77');
    expect(basePaid!.status).toBe('PARTIALLY_PAID');

    // Row 2 — control (unpaid + overdue): late fee applied (tier2 = 100), flipped OVERDUE
    const unpaid = await prisma.payment.findFirst({ where: { contractId, installmentNo: 2 } });
    expect(new Prisma.Decimal(unpaid!.lateFee.toString()).toString()).toBe('100');
    expect(unpaid!.status).toBe('OVERDUE');
  });

  it('still recomputes the fee + flips OVERDUE for a PARTIAL principal row (0 < amountPaid < amountDue)', async () => {
    const svc = new OverdueLifecycleCronService(
      prisma as any,
      new ConsecutiveMissedService(prisma as any),
    );
    await svc.calculateLateFees();

    // Row 3 — base only partly paid: guard `amount_paid < amount_due` is TRUE, so the
    // row is processed like any overdue row — fee recomputed to tier2 (100, NOT frozen 77),
    // status flipped OVERDUE. Confirms the skip applies ONLY to base-settled rows.
    const partial = await prisma.payment.findFirst({ where: { contractId, installmentNo: 3 } });
    expect(new Prisma.Decimal(partial!.lateFee.toString()).toString()).toBe('100');
    expect(partial!.status).toBe('OVERDUE');
  });
});
