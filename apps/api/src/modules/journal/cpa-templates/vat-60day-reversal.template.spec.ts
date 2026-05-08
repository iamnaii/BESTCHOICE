import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { Vat60dayMandatoryTemplate } from './vat-60day-mandatory.template';
import { Vat60dayReversalTemplate } from './vat-60day-reversal.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function setup() {
  // Clean in FK-safe order
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
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
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

  await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

  const inst = await prisma.installmentSchedule.findFirstOrThrow({
    where: { contractId: c.id, installmentNo: 1 },
  });

  // Backdate dueDate and post the mandatory JE
  await prisma.installmentSchedule.update({
    where: { id: inst.id },
    data: { dueDate: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000) },
  });

  const mandatory = new Vat60dayMandatoryTemplate(journal, prisma as any);
  await mandatory.execute(inst.id);

  return { contract: c, inst, journal };
}

describe('Vat60dayReversalTemplate', () => {
  it('mirrors mandatory at 1x vatPerInst (per ม.82/3)', async () => {
    const { inst, journal } = await setup();

    const reversal = new Vat60dayReversalTemplate(journal, prisma as any);
    const result = await reversal.execute(inst.id);

    expect(result).not.toBeNull();
    expect(result?.entryNo).toBeTruthy();

    // Fetch the reversal JE
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { metadata: { path: ['tag'], equals: 'VAT60-REVERSAL' } } as any,
      include: { lines: true },
    });

    const line2123 = entry.lines.find((l) => l.accountCode === '21-2103');
    const line1124 = entry.lines.find((l) => l.accountCode === '11-2104');

    expect(line2123).toBeDefined();
    expect(line1124).toBeDefined();

    // 51-1105 must NOT exist (mandatory had no 51-1101 expense to reverse)
    const line5115 = entry.lines.find((l) => l.accountCode === '51-1105');
    expect(line5115).toBeUndefined();

    // Dr 21-2103 = 1× vatPerInst (99.17), mirrors mandatory Cr 21-2103 = 99.17
    expect(new Decimal(line2123!.debit.toString()).toFixed(2)).toBe('99.17');
    expect(new Decimal(line2123!.credit.toString()).toFixed(2)).toBe('0.00');

    // Cr 11-2104 = 99.17 (clears the receivable mandatory recorded)
    expect(new Decimal(line1124!.debit.toString()).toFixed(2)).toBe('0.00');
    expect(new Decimal(line1124!.credit.toString()).toFixed(2)).toBe('99.17');

    // Balanced at 1×
    const totalDr = entry.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = entry.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    expect(totalDr.toFixed(2)).toBe('99.17');
  });

  it('clears vat60dayJournalEntryId after reversal', async () => {
    const { inst, journal } = await setup();

    // Ensure it was set by mandatory
    const before = await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: inst.id } });
    expect(before.vat60dayJournalEntryId).not.toBeNull();

    const reversal = new Vat60dayReversalTemplate(journal, prisma as any);
    await reversal.execute(inst.id);

    const after = await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: inst.id } });
    expect(after.vat60dayJournalEntryId).toBeNull();
  });

  it('returns null if no mandatory JE was posted (idempotent)', async () => {
    // Use a fresh install where mandatory was NOT run
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
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({ where: { contractNumber: { startsWith: 'TEST-' } } });
    await seedFinanceCoa(prisma);

    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 1 },
    });

    // vat60dayJournalEntryId is null — no mandatory JE
    const reversal = new Vat60dayReversalTemplate(journal, prisma as any);
    const result = await reversal.execute(inst.id);
    expect(result).toBeNull();
  });
});
