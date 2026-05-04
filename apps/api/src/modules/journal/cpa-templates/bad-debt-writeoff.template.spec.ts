import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { BadDebtProvisionTemplate } from './bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from './bad-debt-writeoff.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function setup() {
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.contract.deleteMany({});
  await seedFinanceCoa(prisma);

  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!existing) {
    await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }

  return new JournalAutoService(prisma as any);
}

describe('BadDebtWriteOffTemplate', () => {
  let journal: JournalAutoService;
  let contractId: string;

  beforeAll(async () => {
    journal = await setup();
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    // Activate contract — posts 1A JE which creates 11-2101 balance
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contractId);
  });

  it('posts a balanced write-off JE (no prior provision)', async () => {
    const tmpl = new BadDebtWriteOffTemplate(journal, prisma as any);
    const result = await tmpl.execute({ contractId, writeOffReason: 'หนี้สูญจากลูกค้าล้มละลาย' });

    expect(result.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
      },
      include: { lines: true },
    });

    expect(je).toBeDefined();
    expect(je!.status).toBe('POSTED');

    const lines = je!.lines;
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Should have Dr 51-1102 (full write-off since no provision)
    const expenseLine = lines.find((l) => l.accountCode === '51-1102');
    expect(expenseLine).toBeDefined();
    expect(new Decimal(expenseLine!.debit.toString()).gt(0)).toBe(true);

    // Should have Cr 11-2101 (clear gross AR)
    const arLine = lines.find((l) => l.accountCode === '11-2101');
    expect(arLine).toBeDefined();
    expect(new Decimal(arLine!.credit.toString()).gt(0)).toBe(true);
  });

  it('is idempotent — second call returns same entry, no duplicate JE', async () => {
    const tmpl = new BadDebtWriteOffTemplate(journal, prisma as any);
    const first = await tmpl.execute({ contractId });
    const second = await tmpl.execute({ contractId });

    expect(first.entryNo).toBe(second.entryNo);

    const count = await prisma.journalEntry.count({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(count).toBe(1);
  });

  it('consumes provision first, then remainder hits P&L', async () => {
    // Activate a fresh contract
    const c2 = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c2.id);

    // Post a provision JE (partial coverage)
    const provisionTmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    await provisionTmpl.execute({
      contractId: c2.id,
      provisionAmount: new Decimal('1000.00'),
      period: '2026-04',
    });

    const writeOffTmpl = new BadDebtWriteOffTemplate(journal, prisma as any);
    const result = await writeOffTmpl.execute({ contractId: c2.id });
    expect(result.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: c2.id } } as any,
        ],
      },
      include: { lines: true },
    });

    expect(je).toBeDefined();

    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Should have Dr 11-2102 (provision consumed)
    const provisionLine = je!.lines.find((l) => l.accountCode === '11-2102');
    expect(provisionLine).toBeDefined();
    expect(new Decimal(provisionLine!.debit.toString()).toFixed(2)).toBe('1000.00');

    // Should have Dr 51-1102 (remainder)
    const expenseLine = je!.lines.find((l) => l.accountCode === '51-1102');
    expect(expenseLine).toBeDefined();
    expect(new Decimal(expenseLine!.debit.toString()).gt(0)).toBe(true);
  });
});
