import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../contract-activation-1a.template';
import { EarlyPayoffJP4Template } from '../early-payoff-jp4.template';
import { RepossessionJP5Template } from '../repossession-jp5.template';
import { Vat60dayReversalTemplate } from '../vat-60day-reversal.template';
import { JournalAutoService } from '../../journal-auto.service';

const prisma = new PrismaClient();

/**
 * Atomicity tests (Wave 1 / Task 2 of audit fixes).
 *
 * Verifies that JE templates respect outer `$transaction` semantics:
 *   - When the outer tx throws after template.execute, no JournalEntry should
 *     be persisted (full rollback).
 *   - When the outer tx succeeds, exactly one JournalEntry should be committed.
 *
 * Coverage:
 *   - Pattern A (no internal $transaction): 1A ContractActivation
 *   - Pattern B (has internal $transaction, must reuse outer when provided): JP4 EarlyPayoff
 *
 * Pattern A is also exercised indirectly by the existing 2A / BadDebtWriteOff
 * unit tests (same `client = tx ?? this.prisma` shape). Pattern B is shared by
 * JP4 and JP5 — the JP4 case is sufficient since both templates use the same
 * `outerTx ? exec(outerTx) : this.prisma.$transaction(exec)` branch.
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

  return new JournalAutoService(prisma as any);
}

/** Count JE rows linked to a specific contract via metadata.contractId. */
async function countJeForContract(contractId: string): Promise<number> {
  return prisma.journalEntry.count({
    where: { metadata: { path: ['contractId'], equals: contractId } as any },
  });
}

/** Sum Dr / Cr per JE for a contract, asserting balanced. */
async function getBalancedJEs(contractId: string) {
  const entries = await prisma.journalEntry.findMany({
    where: { metadata: { path: ['contractId'], equals: contractId } as any },
    include: { lines: true },
  });
  return entries.map((e) => {
    const totalDr = e.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = e.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    return { entryNumber: e.entryNumber, totalDr, totalCr };
  });
}

describe('JE template atomicity (Wave 1 / P0)', () => {
  beforeAll(async () => {
    await setup();
  });

  // -------------------------------------------------------------------------
  // Pattern A: 1A ContractActivation (no internal $transaction)
  // -------------------------------------------------------------------------

  describe('Pattern A — ContractActivation1ATemplate', () => {
    it('rolls back 1A JE when outer transaction throws', async () => {
      const journal = new JournalAutoService(prisma as any);
      const tmpl = new ContractActivation1ATemplate(journal, prisma as any);

      const c = await seedStandard17k12m(prisma);
      const before = await countJeForContract(c.id);

      await expect(
        prisma.$transaction(async (tx) => {
          await tmpl.execute(c.id, tx);
          throw new Error('simulated downstream failure');
        }),
      ).rejects.toThrow('simulated downstream failure');

      const after = await countJeForContract(c.id);
      expect(after).toBe(before);

      // No JournalLines for this contract should have leaked through
      const orphanLines = await prisma.journalLine.findMany({
        where: {
          journalEntry: { metadata: { path: ['contractId'], equals: c.id } as any },
        },
      });
      expect(orphanLines.length).toBe(0);
    });

    it('commits 1A JE when outer transaction succeeds', async () => {
      const journal = new JournalAutoService(prisma as any);
      const tmpl = new ContractActivation1ATemplate(journal, prisma as any);

      const c = await seedStandard17k12m(prisma);
      const before = await countJeForContract(c.id);

      await prisma.$transaction(async (tx) => {
        await tmpl.execute(c.id, tx);
      });

      const after = await countJeForContract(c.id);
      expect(after).toBe(before + 1);

      // JE should be balanced (Dr = Cr)
      const jes = await getBalancedJEs(c.id);
      expect(jes.length).toBe(1);
      expect(jes[0].totalDr.equals(jes[0].totalCr)).toBe(true);
      expect(jes[0].totalDr.gt(0)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Pattern B: JP4 EarlyPayoff (has internal $transaction — must reuse outer)
  // -------------------------------------------------------------------------

  describe('Pattern B — EarlyPayoffJP4Template', () => {
    it('rolls back JP4 JE + Payment rows when outer transaction throws', async () => {
      const journal = new JournalAutoService(prisma as any);
      const oneA = new ContractActivation1ATemplate(journal, prisma as any);
      const jp4 = new EarlyPayoffJP4Template(
        journal,
        prisma as any,
        new Vat60dayReversalTemplate(journal, prisma as any),
      );

      const c = await seedStandard17k12m(prisma);
      // Seed 1A so the contract has receivable to pay off
      await oneA.execute(c.id);

      const beforeJe = await countJeForContract(c.id);
      const beforePayments = await prisma.payment.count({ where: { contractId: c.id } });

      await expect(
        prisma.$transaction(async (tx) => {
          await jp4.execute(
            {
              contractId: c.id,
              depositAccountCode: '11-1101',
              interestDiscountPercent: new Decimal('0'),
            },
            tx,
          );
          throw new Error('simulated downstream failure');
        }),
      ).rejects.toThrow('simulated downstream failure');

      const afterJe = await countJeForContract(c.id);
      const afterPayments = await prisma.payment.count({ where: { contractId: c.id } });

      // No new JE and no new Payment rows should have been committed
      expect(afterJe).toBe(beforeJe);
      expect(afterPayments).toBe(beforePayments);

      // No JP4 flow JE should exist
      const jp4Entries = await prisma.journalEntry.findMany({
        where: {
          AND: [
            { metadata: { path: ['contractId'], equals: c.id } } as any,
            { metadata: { path: ['flow'], equals: 'early-payoff' } } as any,
          ],
        },
      });
      expect(jp4Entries.length).toBe(0);
    });

    it('commits JP4 JE + Payment rows when outer transaction succeeds', async () => {
      const journal = new JournalAutoService(prisma as any);
      const oneA = new ContractActivation1ATemplate(journal, prisma as any);
      const jp4 = new EarlyPayoffJP4Template(
        journal,
        prisma as any,
        new Vat60dayReversalTemplate(journal, prisma as any),
      );

      const c = await seedStandard17k12m(prisma);
      await oneA.execute(c.id);

      const beforeJe = await countJeForContract(c.id);
      const beforePayments = await prisma.payment.count({ where: { contractId: c.id } });

      await prisma.$transaction(async (tx) => {
        await jp4.execute(
          {
            contractId: c.id,
            depositAccountCode: '11-1101',
            interestDiscountPercent: new Decimal('0'),
          },
          tx,
        );
      });

      const afterJe = await countJeForContract(c.id);
      const afterPayments = await prisma.payment.count({ where: { contractId: c.id } });

      // +1 JP4 JE and +12 Payment rows (one per installment)
      expect(afterJe).toBe(beforeJe + 1);
      expect(afterPayments).toBe(beforePayments + c.installmentCount);

      // The JP4 JE should be balanced
      const jp4Entries = await prisma.journalEntry.findMany({
        where: {
          AND: [
            { metadata: { path: ['contractId'], equals: c.id } } as any,
            { metadata: { path: ['flow'], equals: 'early-payoff' } } as any,
          ],
        },
        include: { lines: true },
      });
      expect(jp4Entries.length).toBe(1);
      const totalDr = jp4Entries[0].lines.reduce(
        (s, l) => s.plus(l.debit.toString()),
        new Decimal(0),
      );
      const totalCr = jp4Entries[0].lines.reduce(
        (s, l) => s.plus(l.credit.toString()),
        new Decimal(0),
      );
      expect(totalDr.equals(totalCr)).toBe(true);
      expect(totalDr.gt(0)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Pattern B (extra): JP5 Repossession — same outerTx wiring as JP4
  // -------------------------------------------------------------------------

  describe('Pattern B — RepossessionJP5Template', () => {
    it('rolls back JP5 JE when outer transaction throws', async () => {
      const journal = new JournalAutoService(prisma as any);
      const oneA = new ContractActivation1ATemplate(journal, prisma as any);
      const jp5 = new RepossessionJP5Template(journal, prisma as any);

      const c = await seedStandard17k12m(prisma);
      await oneA.execute(c.id);

      const beforeJe = await countJeForContract(c.id);

      await expect(
        prisma.$transaction(async (tx) => {
          await jp5.execute(
            {
              contractId: c.id,
              depositAccountCode: '11-1101',
              repossessionValue: new Decimal('7000.00'),
            },
            tx,
          );
          throw new Error('simulated downstream failure');
        }),
      ).rejects.toThrow('simulated downstream failure');

      const afterJe = await countJeForContract(c.id);
      expect(afterJe).toBe(beforeJe);

      const jp5Entries = await prisma.journalEntry.findMany({
        where: {
          AND: [
            { metadata: { path: ['contractId'], equals: c.id } } as any,
            { metadata: { path: ['flow'], equals: 'repossession' } } as any,
          ],
        },
      });
      expect(jp5Entries.length).toBe(0);
    });
  });
});
