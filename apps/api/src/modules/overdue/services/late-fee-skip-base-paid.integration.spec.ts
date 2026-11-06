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
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
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
    // Row 3 — once a partial receipt exists, keep its cumulative fee even when
    // the current bracket differs. A later receipt must not add a new auto fee.
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
    // Row 4 — an on-time first partial had no fee. Becoming overdue later must
    // not introduce a fee automatically on that same installment.
    await prisma.payment.create({
      data: {
        contractId, installmentNo: 4, amountDue: new Prisma.Decimal('3671.00'),
        amountPaid: new Prisma.Decimal('1000.00'), lateFee: new Prisma.Decimal(0),
        dueDate: new Date(now - 10 * 86_400_000), status: 'PARTIALLY_PAID',
      },
    });
    // Row 5 — partly waived (150 fee, 110 collected, 40 waived) and then every receipt
    // voided: amountPaid is back to 0 but the waiver stands → the 110 it left stays the
    // fee; the 100 bracket must not come back.
    await prisma.payment.create({
      data: {
        contractId, installmentNo: 5, amountDue: new Prisma.Decimal('3671.00'),
        amountPaid: new Prisma.Decimal(0), lateFee: new Prisma.Decimal('110.00'),
        lateFeeWaived: false, waivedAmount: new Prisma.Decimal('40.00'),
        dueDate: new Date(now - 10 * 86_400_000), status: 'OVERDUE',
      },
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
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

  it('preserves the fee and status after any partial payment, including an original zero fee', async () => {
    const svc = new OverdueLifecycleCronService(
      prisma as any,
      new ConsecutiveMissedService(prisma as any),
    );
    await svc.calculateLateFees();

    const partial = await prisma.payment.findFirst({ where: { contractId, installmentNo: 3 } });
    expect(new Prisma.Decimal(partial!.lateFee.toString()).toString()).toBe('77');
    expect(partial!.status).toBe('PARTIALLY_PAID');
    const zeroFee = await prisma.payment.findFirst({ where: { contractId, installmentNo: 4 } });
    expect(zeroFee!.lateFee.toFixed(2)).toBe('0.00');
    expect(zeroFee!.status).toBe('PARTIALLY_PAID');
  });

  it('keeps the charge an approved waiver left after every receipt was voided (amountPaid 0)', async () => {
    const svc = new OverdueLifecycleCronService(
      prisma as never,
      new ConsecutiveMissedService(prisma as never),
    );
    await svc.calculateLateFees();

    const waived = await prisma.payment.findFirst({ where: { contractId, installmentNo: 5 } });
    expect(waived!.lateFee.toFixed(2)).toBe('110.00');
    expect(waived!.waivedAmount?.toFixed(2)).toBe('40.00');
  });
});
