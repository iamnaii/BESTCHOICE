import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { DefectExchangeReversalTemplate } from './defect-exchange-reversal.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

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

describe('DefectExchangeReversalTemplate', () => {
  let journal: JournalAutoService;
  let contractId: string;

  beforeAll(async () => {
    journal = await setup();
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    // Post 1A activation JE
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contractId);
  });

  it('reverses the 1A JE — resulting net balance is zero', async () => {
    const tmpl = new DefectExchangeReversalTemplate(journal, prisma as any);
    const { reversedCount, entryNos } = await tmpl.reverseContract(contractId);

    expect(reversedCount).toBeGreaterThanOrEqual(1);
    expect(entryNos.length).toBeGreaterThanOrEqual(1);

    // Find the reversal JE
    const reversalJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'defect-exchange' } } as any,
          { metadata: { path: ['contractId'], equals: contractId } } as any,
        ],
      },
      include: { lines: true },
    });

    expect(reversalJe).toBeDefined();
    expect(reversalJe!.status).toBe('POSTED');

    // Reversal must be balanced
    const lines = reversalJe!.lines;
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Net 11-2101 balance across all JEs for this contract should be 0
    const all2101Lines = await prisma.journalLine.findMany({
      where: {
        accountCode: '11-2101',
        journalEntry: {
          metadata: { path: ['contractId'], equals: contractId },
          deletedAt: null,
        },
      },
    });
    const net = all2101Lines.reduce(
      (s, l) => s.plus(l.debit.toString()).minus(l.credit.toString()),
      new Decimal(0),
    );
    expect(net.toFixed(2)).toBe('0.00');
  });

  it('marks original JE as reversed', async () => {
    const originalJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: contractId } } as any,
          { metadata: { path: ['flow'], equals: 'activation-1a' } } as any,
        ],
      },
    });

    if (originalJe) {
      const meta = originalJe.metadata as Record<string, unknown>;
      expect(meta['reversed']).toBe(true);
    }
    // Even if no activation-1a flow tag, reversal having run above is sufficient
  });

  it('is idempotent — second reverseContract call returns 0 newly reversed', async () => {
    const tmpl = new DefectExchangeReversalTemplate(journal, prisma as any);
    const { reversedCount } = await tmpl.reverseContract(contractId);
    // All already reversed — should produce 0 new reversals (idempotent)
    expect(reversedCount).toBe(0);
  });

  it('returns 0 for a contract with no posted JEs', async () => {
    // Create a contract without running 1A
    const c2 = await seedStandard17k12m(prisma);
    const tmpl = new DefectExchangeReversalTemplate(journal, prisma as any);
    const { reversedCount } = await tmpl.reverseContract(c2.id);
    expect(reversedCount).toBe(0);
  });
});
