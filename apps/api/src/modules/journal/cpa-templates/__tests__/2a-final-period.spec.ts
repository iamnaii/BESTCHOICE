import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../installment-accrual-2a.template';
import { JournalAutoService } from '../../journal-auto.service';

const prisma = new PrismaClient();

/**
 * Wave 1 / Task 6 — 2A Final-Period Residual Adjustment.
 * Phase 2 EIR migration — interestPerInst now follows declining-balance EIR.
 *
 * Without the adjustment, ROUND_DOWN on installmentExclVat (1416.66) and
 * ROUND_HALF_UP on vatPerInst (99.17) leak residuals after 12 installments:
 *   11-2101 Cr: 1416.66 × 12 = 16,999.92 (under by 0.08)
 *   11-2105 Cr: 99.17  × 12 = 1,190.04 (over by 0.04)
 *
 * Final-period adjustment makes installment 12 absorb the residual so
 * full-cycle totals match the contract amounts EXACTLY.
 *
 * Interest residual is handled by allocateInterestEIR() utility — no
 * extra adjustment needed in the template.
 *
 * Acceptance:
 *   - installmentExclVat / vatPerInst constant for installments 1..11
 *   - interestPerInst varies by EIR (period 1 highest, period 12 lowest)
 *   - Sum across all 12 = 17,000.00 / 1,190.00 / 6,000.00 EXACTLY
 */

async function setup() {
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.eDocument.deleteMany({});
  await prisma.signature.deleteMany({});
  await prisma.contractDocument.deleteMany({});
  await prisma.partialPaymentLink.deleteMany({});
  await prisma.warrantyAuditLog.deleteMany({});
  await prisma.badDebtWriteOffAuditLog.deleteMany({});
  await prisma.promiseSlot.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.dunningAction.deleteMany({});
  await prisma.repossession.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.contract.deleteMany({});
  await seedFinanceCoa(prisma);

  const exists = await prisma.user.findUnique({ where: { email: 'admin@bestchoice.com' } });
  if (!exists) {
    await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }
}

interface AccrualSummary {
  installmentNo: number;
  cr11_2101: Decimal; // installmentExclVat
  cr11_2105: Decimal; // vatPerInst
  cr41_1101: Decimal; // interestPerInst
  cr21_2101: Decimal; // vatPerInst (same as 11-2105)
  dr11_2103: Decimal; // installmentTotal
}

async function get2AEntriesForContract(contractId: string): Promise<AccrualSummary[]> {
  const entries = await prisma.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: contractId } as any },
        { metadata: { path: ['tag'], equals: '2A' } as any },
      ],
    },
    include: { lines: true },
    orderBy: { postedAt: 'asc' },
  });
  return entries.map((e) => {
    const installmentScheduleId = (e.metadata as any)?.installmentScheduleId as string;
    const find = (code: string, side: 'dr' | 'cr') => {
      const line = e.lines.find((l) => l.accountCode === code);
      if (!line) return new Decimal(0);
      return new Decimal((side === 'dr' ? line.debit : line.credit).toString());
    };
    return {
      installmentNo: 0, // resolved below
      installmentScheduleId,
      cr11_2101: find('11-2101', 'cr'),
      cr11_2105: find('11-2105', 'cr'),
      cr41_1101: find('41-1101', 'cr'),
      cr21_2101: find('21-2101', 'cr'),
      dr11_2103: find('11-2103', 'dr'),
    } as AccrualSummary & { installmentScheduleId: string };
  }) as any;
}

async function attachInstallmentNumbers(
  rows: (AccrualSummary & { installmentScheduleId: string })[],
): Promise<AccrualSummary[]> {
  const ids = rows.map((r) => r.installmentScheduleId).filter(Boolean);
  const insts = await prisma.installmentSchedule.findMany({
    where: { id: { in: ids } },
    select: { id: true, installmentNo: true },
  });
  const byId = new Map(insts.map((i) => [i.id, i.installmentNo]));
  return rows
    .map((r) => ({ ...r, installmentNo: byId.get(r.installmentScheduleId) ?? 0 }))
    .sort((a, b) => a.installmentNo - b.installmentNo);
}

describe('Template 2A — Final-Period Residual Adjustment (Wave 1 / Task 6)', () => {
  beforeAll(async () => {
    await setup();
  });

  it('clears 11-2101 and 11-2105 to exactly 0 on installment 12 (final period)', async () => {
    const journal = new JournalAutoService(prisma as any);
    const oneA = new ContractActivation1ATemplate(journal, prisma as any);
    const tmpl = new InstallmentAccrual2ATemplate(journal, prisma as any);

    const c = await seedStandard17k12m(prisma);
    await oneA.execute(c.id);

    // Run 2A on every installment (1..12) in order
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });
    expect(insts.length).toBe(12);

    for (const inst of insts) {
      await tmpl.execute(inst.id);
    }

    const rawRows = await get2AEntriesForContract(c.id);
    const rows = await attachInstallmentNumbers(rawRows as any);

    expect(rows.length).toBe(12);

    // Aggregate sums across all 12 installments
    const sumExclVat = rows.reduce((s, r) => s.plus(r.cr11_2101), new Decimal(0));
    const sumVat = rows.reduce((s, r) => s.plus(r.cr11_2105), new Decimal(0));
    const sumInterest = rows.reduce((s, r) => s.plus(r.cr41_1101), new Decimal(0));
    const sumVatOutput = rows.reduce((s, r) => s.plus(r.cr21_2101), new Decimal(0));

    // EXACT match to contract totals (no residual leak)
    expect(sumExclVat.toFixed(2)).toBe('17000.00');
    expect(sumVat.toFixed(2)).toBe('1190.00');
    expect(sumInterest.toFixed(2)).toBe('6000.00');
    expect(sumVatOutput.toFixed(2)).toBe('1190.00');

    // Final installment carries the residual:
    //   prior-11 11-2101 Cr = 11 × 1416.66 = 15,583.26
    //   final-12 11-2101 Cr = 17,000 - 15,583.26 = 1,416.74
    const final = rows.find((r) => r.installmentNo === 12)!;
    expect(final).toBeDefined();
    expect(final.cr11_2101.toFixed(2)).toBe('1416.74'); // 17000 - 11*1416.66
    expect(final.cr11_2105.toFixed(2)).toBe('99.13');   // 1190 - 11*99.17
    expect(final.cr21_2101.toFixed(2)).toBe('99.13');   // mirror of 11-2105
    // EIR period 12 interest is small (declining balance, last period snap)
    expect(final.cr41_1101.toNumber()).toBeLessThan(150);

    // Final 11-2103 Dr = installmentExclVat + vatPerInst = 1416.74 + 99.13 = 1515.87
    expect(final.dr11_2103.toFixed(2)).toBe('1515.87');
  });

  it('non-final periods unchanged — installments 1-11 still use original CSV-spec rounding', async () => {
    const journal = new JournalAutoService(prisma as any);
    const oneA = new ContractActivation1ATemplate(journal, prisma as any);
    const tmpl = new InstallmentAccrual2ATemplate(journal, prisma as any);

    const c = await seedStandard17k12m(prisma);
    await oneA.execute(c.id);

    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });

    for (const inst of insts) {
      await tmpl.execute(inst.id);
    }

    const rawRows = await get2AEntriesForContract(c.id);
    const rows = await attachInstallmentNumbers(rawRows as any);

    // Non-final installments keep CSV-spec exact values for installmentExclVat + VAT
    // (interestPerInst now varies by EIR — declining each period)
    for (const r of rows.filter((x) => x.installmentNo !== 12)) {
      expect(r.cr11_2101.toFixed(2)).toBe('1416.66');
      expect(r.cr11_2105.toFixed(2)).toBe('99.17');
      expect(r.cr21_2101.toFixed(2)).toBe('99.17');
      expect(r.dr11_2103.toFixed(2)).toBe('1515.83'); // 1416.66 + 99.17
    }

    // EIR interest schedule: period 1 highest, declining each period
    const i1 = rows.find((x) => x.installmentNo === 1)!;
    const i11 = rows.find((x) => x.installmentNo === 11)!;
    expect(i1.cr11_2101.toFixed(2)).toBe('1416.66');
    expect(i11.cr11_2101.toFixed(2)).toBe('1416.66');
    // EIR period 1 ≈ 817.05 (openingPrincipal=11000 × monthlyEIR ≈ 7.43%)
    expect(i1.cr41_1101.toFixed(2)).toBe('817.05');
    // EIR period 11 ≈ 189.13 (declining balance)
    expect(i11.cr41_1101.toFixed(2)).toBe('189.13');
    // Period 1 > Period 11 (declining)
    expect(i1.cr41_1101.greaterThan(i11.cr41_1101)).toBe(true);
  });
});
