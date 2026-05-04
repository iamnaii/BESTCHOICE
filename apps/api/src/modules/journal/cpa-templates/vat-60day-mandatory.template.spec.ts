import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { Vat60dayMandatoryTemplate } from './vat-60day-mandatory.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function setup() {
  // Clean in FK-safe order
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  // Delete only test contracts (by contractNumber prefix) to avoid FK issues from other test data
  await prisma.contract.deleteMany({ where: { contractNumber: { startsWith: 'TEST-' } } });
  await seedFinanceCoa(prisma);

  const exists = await prisma.user.findUnique({ where: { email: 'admin@bestchoice.com' } });
  if (!exists) {
    await prisma.user.create({
      data: {
        email: 'admin@bestchoice.com',
        password: 'x',
        name: 'admin',
        role: 'OWNER',
      },
    });
  }

  const c = await seedStandard17k12m(prisma);
  const journal = new JournalAutoService(prisma as any);

  // Run 1A to activate contract
  await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

  const inst = await prisma.installmentSchedule.findFirstOrThrow({
    where: { contractId: c.id, installmentNo: 1 },
  });

  return { contract: c, inst, journal };
}

describe('Vat60dayMandatoryTemplate', () => {
  it('posts the correct double-entry JE (vatPerInst=99.17)', async () => {
    const { inst, journal } = await setup();

    // Backdate installment dueDate to 70 days ago (past the 60-day threshold)
    await prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { dueDate: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000) },
    });

    const tmpl = new Vat60dayMandatoryTemplate(journal, prisma as any);
    const result = await tmpl.execute(inst.id);

    expect(result).not.toBeNull();
    expect(result?.entryNo).toBeTruthy();

    // Fetch the journal entry
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { metadata: { path: ['tag'], equals: 'VAT60-MANDATORY' } } as any,
      include: { lines: true },
    });

    const line5101 = entry.lines.find((l) => l.accountCode === '51-1101');
    const line1124 = entry.lines.find((l) => l.accountCode === '11-2104');
    const line2123 = entry.lines.find((l) => l.accountCode === '21-2103');

    expect(line5101).toBeDefined();
    expect(line1124).toBeDefined();
    expect(line2123).toBeDefined();

    // vatPerInst = 1190 / 12 = 99.1666... rounded HALF_UP → 99.17
    expect(new Decimal(line5101!.debit.toString()).toFixed(2)).toBe('99.17');
    expect(new Decimal(line5101!.credit.toString()).toFixed(2)).toBe('0.00');

    expect(new Decimal(line1124!.debit.toString()).toFixed(2)).toBe('99.17');
    expect(new Decimal(line1124!.credit.toString()).toFixed(2)).toBe('0.00');

    expect(new Decimal(line2123!.debit.toString()).toFixed(2)).toBe('0.00');
    expect(new Decimal(line2123!.credit.toString()).toFixed(2)).toBe('198.34');

    // Verify balanced: total Dr = total Cr
    const totalDr = entry.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = entry.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Verify installment now has vat60dayJournalEntryId set
    const updatedInst = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: inst.id },
    });
    expect(updatedInst.vat60dayJournalEntryId).toBe(result!.entryNo);
  });

  it('is idempotent — returns null if already processed', async () => {
    const { inst, journal } = await setup();

    await prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { dueDate: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000) },
    });

    const tmpl = new Vat60dayMandatoryTemplate(journal, prisma as any);

    // First call — should succeed
    const first = await tmpl.execute(inst.id);
    expect(first).not.toBeNull();

    // Second call — should return null (already processed)
    const second = await tmpl.execute(inst.id);
    expect(second).toBeNull();

    // Should still be only 1 VAT60-MANDATORY entry
    const count = await prisma.journalEntry.count({
      where: { metadata: { path: ['tag'], equals: 'VAT60-MANDATORY' } } as any,
    });
    expect(count).toBe(1);
  });
});
