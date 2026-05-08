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
import { RepossessionJP5Template } from './repossession-jp5.template';
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

describe('RepossessionJP5Template', () => {
  it('matches CSV golden case-5 with 4 paid + 8 unpaid + repoValue 7000 (loss path)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Pay 4 installments
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const pay = new PaymentReceipt2BTemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });

    for (let i = 0; i < 4; i++) {
      await accrual.execute(insts[i].id);
      await pay.execute({
        installmentScheduleId: insts[i].id,
        amountReceived: new Decimal('1515.83'),
        depositAccountCode: '11-1101',
      });
    }

    // Repossession with value 7000 (loss scenario)
    const tmpl = new RepossessionJP5Template(journal, prisma as any);
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('7000.00'),
    });

    // Load golden fixture and find the close-out block (tag "3" containing 51-1102)
    const expected = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-5-repossession.csv'),
    );
    const closeoutBlock = expected.entries.find((e) =>
      e.lines.some((l) => l.code === '51-1102' && new Decimal(l.dr).gt(0)),
    );
    expect(closeoutBlock, 'closeout block with 51-1102 Dr not found in CSV').toBeDefined();

    // Find the repossession JE posted
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: c.id } } as any,
          { metadata: { path: ['flow'], equals: 'repossession' } } as any,
        ],
      },
      include: { lines: true },
    });

    expect(entries.length, 'expected exactly 1 repossession JE').toBe(1);

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

  it('uses 41-1102 (gain) when repossessionValue > remainingTotal', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const tmpl = new RepossessionJP5Template(journal, prisma as any);
    // repossessionValue 20000 >> remainingTotal (~18k) → gain path
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('20000.00'),
    });

    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['flow'], equals: 'repossession' } } as any,
      include: { lines: true },
    });

    expect(entries.length, 'expected exactly 1 repossession JE').toBe(1);

    const gain = entries[0].lines.find((l) => l.accountCode === '41-1102');
    expect(gain, '41-1102 gain line should exist').toBeDefined();
    expect(new Decimal(gain!.credit.toString()).gt(0), '41-1102 credit should be positive').toBe(
      true,
    );

    const loss = entries[0].lines.find((l) => l.accountCode === '51-1102');
    expect(loss, '51-1102 loss line should not exist in gain path').toBeUndefined();
  });

  it('throws when no unpaid installments remain', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Mark all installments as PAID
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

    const tmpl = new RepossessionJP5Template(journal, prisma as any);
    await expect(
      tmpl.execute({
        contractId: c.id,
        depositAccountCode: '11-1101',
        repossessionValue: new Decimal('7000.00'),
      }),
    ).rejects.toThrow(/nothing to repossess/i);
  });
});
