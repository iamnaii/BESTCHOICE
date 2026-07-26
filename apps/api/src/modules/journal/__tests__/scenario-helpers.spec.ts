import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m, formatJEsAsBlocks } from './scenario-helpers';

const prisma = new PrismaClient();

beforeAll(async () => {
  // Wipe in dependency order (Restrict FKs: JournalLine → JournalEntry first)
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.eDocument.deleteMany({});
  await prisma.signature.deleteMany({});
  await prisma.contractDocument.deleteMany({});
  await prisma.partialPaymentLink.deleteMany({});
  await prisma.warrantyAuditLog.deleteMany({});
  // NOT wiped: badDebtWriteOffAuditLog is immutable (DB trigger, T1-C7) —
  // deleteMany({}) throws once any row exists (see cn-issue-on-writeoff.spec.ts).
  await prisma.promiseSlot.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.dunningAction.deleteMany({});
  await prisma.repossession.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
  // contract written off via the real writeOffBadDebt() has a permanent
  // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
  await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
  await seedFinanceCoa(prisma);
});

describe('seedStandard17k12m', () => {
  it('creates contract with expected derived values', async () => {
    const c = await seedStandard17k12m(prisma);
    expect(c.financedAmount.toFixed(2)).toBe('10000.00');
    expect(c.commission.toFixed(2)).toBe('1000.00');
    expect(c.interest.toFixed(2)).toBe('6000.00');
    expect(c.vatTotal.toFixed(2)).toBe('1190.00');
    expect(c.installmentCount).toBe(12);
    // 17000/12 = 1416.67 (ROUND_HALF_UP) + 1190/12 = 99.17 = 1515.84
    // (plan doc says 1515.83 — off by 1 cent due to separate rounding of each part)
    expect(c.installmentTotal.toFixed(2)).toBe('1515.84');
  });

  it('seeds 12 installment_schedules rows', async () => {
    const c = await seedStandard17k12m(prisma);
    const count = await prisma.installmentSchedule.count({ where: { contractId: c.id } });
    expect(count).toBe(12);
  });

  it('formatJEsAsBlocks returns empty array when no JEs exist', async () => {
    const c = await seedStandard17k12m(prisma);
    const blocks = await formatJEsAsBlocks(prisma, c.id);
    expect(blocks).toEqual([]);
  });
});
