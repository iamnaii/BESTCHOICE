import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { loadCaseFromCsv } from '../__tests__/csv-fixture-loader';
import { diffGoldenJE } from '../__tests__/golden-je-matcher';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { PaymentReceipt2BTemplate } from './payment-receipt-2b.template';
import { Vat60dayMandatoryTemplate } from './vat-60day-mandatory.template';
import { Vat60dayReversalTemplate } from './vat-60day-reversal.template';
import { JournalAutoService } from '../journal-auto.service';
import type { ActualJe } from '../__tests__/golden-je-matcher';

const prisma = new PrismaClient();

async function setup() {
  // Clean slate for each test
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.contract.deleteMany({});
  await seedFinanceCoa(prisma);

  // Ensure system admin user exists (needed by JournalAutoService.resolveSystemUserId)
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

  // Run Template 1A (contract activation)
  await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

  // Get first installment schedule
  const inst = await prisma.installmentSchedule.findFirstOrThrow({
    where: { contractId: c.id, installmentNo: 1 },
  });

  // Run Template 2A (accrual)
  await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(inst.id);

  return { contract: c, inst, journal };
}

async function get2BLines(contractId: string): Promise<ActualJe[] | null> {
  const entries = await prisma.journalEntry.findMany({
    where: { metadata: { path: ['contractId'], equals: contractId } } as any,
    include: { lines: true },
  });

  const tag2B = entries.find((e) => (e.metadata as any)?.tag === '2B');
  if (!tag2B) return null;

  return [
    {
      tag: '2B',
      lines: tag2B.lines.map((l) => ({
        code: l.accountCode,
        dr: new Decimal(l.debit.toString()),
        cr: new Decimal(l.credit.toString()),
      })),
    },
  ];
}

describe('PaymentReceipt2BTemplate', () => {
  it('case 1 — overpay 0.17 routes to 53-1503', async () => {
    const { contract, inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal('1516.00'),
      depositAccountCode: '11-1101',
    });

    const expected = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-1-overpay.csv'),
    );
    const expected2B = expected.entries.filter((e) => e.tag === '2B');
    const actual = await get2BLines(contract.id);

    expect(actual).not.toBeNull();
    expect(actual?.length).toBe(1);
    const diff = diffGoldenJE(expected2B, actual!);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
  });

  it('case 2 — underpay 0.83 routes to 52-1104', async () => {
    const { contract, inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal('1515.00'),
      depositAccountCode: '11-1101',
      toleranceApproverId: 'test-approver-id',
    });

    const expected = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-2-underpay.csv'),
    );
    const expected2B = expected.entries.filter((e) => e.tag === '2B');
    const actual = await get2BLines(contract.id);

    expect(actual).not.toBeNull();
    expect(actual?.length).toBe(1);
    const diff = diffGoldenJE(expected2B, actual!);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
  });

  it('rejects overpay/underpay >1฿', async () => {
    const { inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

    await expect(
      tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('1500.00'),
        depositAccountCode: '11-1101',
      }),
    ).rejects.toThrow(/exceeds tolerance/i);
  });

  it('rejects underpay without approver', async () => {
    const { inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

    await expect(
      tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('1515.00'),
        depositAccountCode: '11-1101',
        // no toleranceApproverId
      }),
    ).rejects.toThrow(/approver/i);
  });

  it('triggers VAT 60-day reversal when installment has vat60dayJournalEntryId set', async () => {
    const { contract, inst, journal } = await setup();

    // Backdate and post the mandatory VAT 60-day JE
    await prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { dueDate: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000) },
    });
    const mandatory = new Vat60dayMandatoryTemplate(journal, prisma as any);
    await mandatory.execute(inst.id);

    // Verify mandatory JE was set
    const instAfterMandatory = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: inst.id },
    });
    expect(instAfterMandatory.vat60dayJournalEntryId).not.toBeNull();

    // Now run 2B with reversal injected
    const reversal = new Vat60dayReversalTemplate(journal, prisma as any);
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any, reversal);

    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal('1515.83'),
      depositAccountCode: '11-1101',
    });

    // Verify 2B JE was posted
    const entry2B = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['tag'], equals: '2B' } } as any,
    });
    expect(entry2B).not.toBeNull();

    // Verify reversal JE was also posted
    const entryReversal = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['tag'], equals: 'VAT60-REVERSAL' } } as any,
    });
    expect(entryReversal).not.toBeNull();

    // Verify vat60dayJournalEntryId was cleared
    const instAfterPayment = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: inst.id },
    });
    expect(instAfterPayment.vat60dayJournalEntryId).toBeNull();
  });

  it('does NOT trigger reversal when no 60-day VAT JE exists', async () => {
    const { inst, journal } = await setup();

    // No mandatory JE — vat60dayJournalEntryId is null
    const reversal = new Vat60dayReversalTemplate(journal, prisma as any);
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any, reversal);

    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal('1515.83'),
      depositAccountCode: '11-1101',
    });

    // Should have 2B but no reversal
    const entry2B = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['tag'], equals: '2B' } } as any,
    });
    expect(entry2B).not.toBeNull();

    const entryReversal = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['tag'], equals: 'VAT60-REVERSAL' } } as any,
    });
    expect(entryReversal).toBeNull();
  });
});
