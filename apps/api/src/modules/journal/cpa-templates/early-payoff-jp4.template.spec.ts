import { describe, it, expect } from 'vitest';
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
import { EarlyPayoffJP4Template } from './early-payoff-jp4.template';
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

describe('EarlyPayoffJP4Template', () => {
  it('matches CSV golden case-4 with 50% interest discount after 6 paid', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Run accrual + payment for 6 installments
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const pay = new PaymentReceipt2BTemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });

    for (let i = 0; i < 6; i++) {
      await accrual.execute(insts[i].id);
      await pay.execute({
        installmentScheduleId: insts[i].id,
        amountReceived: new Decimal('1515.83'),
        depositAccountCode: '11-1101',
      });
    }

    // Early payoff with 50% discount on remaining 6 installments
    const tmpl = new EarlyPayoffJP4Template(journal, prisma as any);
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      interestDiscountPercent: new Decimal('50'),
    });

    // Load golden fixture and find the close-out block (tag "3" with 52-1106)
    const expected = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-4-early-payoff.csv'),
    );
    const closeoutBlock = expected.entries.find((e) =>
      e.lines.some((l) => l.code === '52-1106' && new Decimal(l.dr).gt(0)),
    );
    expect(closeoutBlock, 'closeout block with 52-1106 not found in CSV').toBeDefined();

    // Find the early-payoff JE posted
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: c.id } } as any,
          { metadata: { path: ['flow'], equals: 'early-payoff' } } as any,
        ],
      },
      include: { lines: true },
    });

    expect(entries.length, 'expected exactly 1 early-payoff JE').toBe(1);

    const actual = [
      {
        tag: closeoutBlock!.tag,
        lines: entries[0].lines.map((l) => ({
          code: l.accountCode,
          dr: new Decimal(l.debit.toString()),
          cr: new Decimal(l.credit.toString()),
        })),
      },
    ];

    const diff = diffGoldenJE([closeoutBlock!], actual);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
  });

  it('marks all remaining installments as PAID', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const pay = new PaymentReceipt2BTemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });

    for (let i = 0; i < 6; i++) {
      await accrual.execute(insts[i].id);
      await pay.execute({
        installmentScheduleId: insts[i].id,
        amountReceived: new Decimal('1515.83'),
        depositAccountCode: '11-1101',
      });
    }

    const tmpl = new EarlyPayoffJP4Template(journal, prisma as any);
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      interestDiscountPercent: new Decimal('50'),
    });

    // After early payoff, all 12 installments should have a PAID Payment record
    const paidCount = await prisma.payment.count({
      where: { contractId: c.id, status: 'PAID' },
    });
    const totalInsts = await prisma.installmentSchedule.count({
      where: { contractId: c.id },
    });
    expect(paidCount, 'all installments should have PAID Payment records after early payoff').toBe(
      totalInsts,
    );
  });

  it('throws when all installments are already paid', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Mark all as PAID by creating Payment records for all installments
    const allInsts = await prisma.installmentSchedule.findMany({ where: { contractId: c.id } });
    for (const inst of allInsts) {
      await prisma.payment.create({
        data: {
          contractId: c.id,
          installmentNo: inst.installmentNo,
          dueDate: inst.dueDate,
          amountDue: new Decimal('1515.83'),
          amountPaid: new Decimal('1515.83'),
          paidDate: new Date(),
          paidAt: new Date(),
          status: 'PAID',
        },
      });
    }

    const tmpl = new EarlyPayoffJP4Template(journal, prisma as any);
    await expect(
      tmpl.execute({
        contractId: c.id,
        depositAccountCode: '11-1101',
        interestDiscountPercent: new Decimal('50'),
      }),
    ).rejects.toThrow(/already paid/i);
  });
});
