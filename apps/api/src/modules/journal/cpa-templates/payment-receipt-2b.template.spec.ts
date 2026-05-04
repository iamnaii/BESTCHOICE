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
});
