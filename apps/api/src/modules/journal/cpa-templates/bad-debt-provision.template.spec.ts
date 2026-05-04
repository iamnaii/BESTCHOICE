import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { BadDebtProvisionTemplate } from './bad-debt-provision.template';
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

describe('BadDebtProvisionTemplate', () => {
  let journal: JournalAutoService;
  let contractId: string;

  beforeAll(async () => {
    journal = await setup();
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    // Activate the contract first so it exists
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contractId);
  });

  it('posts a balanced provision JE with correct accounts', async () => {
    const tmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      contractId,
      provisionAmount: new Decimal('500.00'),
      period: '2026-04',
    });

    expect(result).not.toBeNull();
    expect(result!.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'provision' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
          { metadata: { path: ['period'], equals: '2026-04' } } as any,
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

    const drLine = lines.find((l) => l.accountCode === '51-1103');
    expect(drLine).toBeDefined();
    expect(new Decimal(drLine!.debit.toString()).toFixed(2)).toBe('500.00');

    const crLine = lines.find((l) => l.accountCode === '11-2102');
    expect(crLine).toBeDefined();
    expect(new Decimal(crLine!.credit.toString()).toFixed(2)).toBe('500.00');
  });

  it('is idempotent — second call returns same entry, no duplicate JE', async () => {
    const tmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    const first = await tmpl.execute({
      contractId,
      provisionAmount: new Decimal('500.00'),
      period: '2026-04',
    });
    const second = await tmpl.execute({
      contractId,
      provisionAmount: new Decimal('500.00'),
      period: '2026-04',
    });

    expect(first!.entryNo).toBe(second!.entryNo);

    const count = await prisma.journalEntry.count({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'provision' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
          { metadata: { path: ['period'], equals: '2026-04' } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(count).toBe(1);
  });

  it('returns null for zero provisionAmount (no-op)', async () => {
    const tmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      contractId,
      provisionAmount: new Decimal('0.00'),
      period: '2026-05',
    });
    expect(result).toBeNull();
  });

  it('posts a separate JE for a different period', async () => {
    const tmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      contractId,
      provisionAmount: new Decimal('200.00'),
      period: '2026-06',
    });

    expect(result).not.toBeNull();

    const jeCount = await prisma.journalEntry.count({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'provision' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
        deletedAt: null,
      },
    });
    // Should have 2026-04 + 2026-06 entries (not 2026-05 which was 0)
    expect(jeCount).toBeGreaterThanOrEqual(2);
  });
});
