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
import { RepossessionJP5Template } from './repossession-jp5.template';
import { ShopCollectSettlementTemplate } from './shop-collect-settlement.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function setup() {
  // JournalPostAuditLog rows (asset flows) FK-reference journal_entries — clear
  // them first or this deleteMany trips P2003 when an asset spec ran earlier.
  await prisma.journalPostAuditLog.deleteMany({});
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

/**
 * PR-843/I2 Phase 5d — the legacy PaymentReceipt2BTemplate was deleted. This
 * reproduces its full-clear posting for one installment directly: creates the
 * PAID Payment row (which the JP5 flow reads to determine the unpaid/accrued
 * count) and posts Dr deposit / Cr 11-2103 for installmentTotal (mirrors what
 * the new primitive would post). The JP5 golden assertions only diff the
 * repossession JE's own lines and depend on the paid/unpaid state, so they are
 * unchanged.
 */
async function postPriorReceipt(
  journal: JournalAutoService,
  contractId: string,
  inst: { id: string; installmentNo: number; dueDate: Date },
): Promise<void> {
  const installmentTotal = new Decimal('1515.83');
  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  const payment = await prisma.payment.create({
    data: {
      contractId,
      installmentNo: inst.installmentNo,
      dueDate: inst.dueDate,
      amountDue: installmentTotal,
      amountPaid: installmentTotal,
      paidDate: new Date(),
      paidAt: new Date(),
      status: 'PAID',
    },
  });
  await journal.createAndPost({
    description: `รับชำระงวด #${inst.installmentNo} — สัญญา ${contract.contractNumber}`,
    reference: payment.id,
    metadata: {
      tag: 'receipt',
      contractId,
      installmentScheduleId: inst.id,
      paymentId: payment.id,
    },
    lines: [
      { accountCode: '11-1101', dr: installmentTotal, cr: new Decimal(0), description: 'รับเงิน' },
      {
        accountCode: '11-2103',
        dr: new Decimal(0),
        cr: installmentTotal,
        description: 'ล้างลูกหนี้ค้างชำระ',
      },
    ],
  });
}

describe('RepossessionJP5Template', () => {
  // (2026-07-03, #1333) Straight-line ตามงวด is the ruled treatment — the Phase 4
  // "EIR migration" regenerated this CSV to EIR (3,012.50) but production never
  // switched: the 2A cron accrues 500/งวด straight-line, so remaining deferred
  // interest for periods 5..12 = 500×8 = 4,000. First-ever CI run of this suite
  // (PR #1330) surfaced the divergence; owner ruled straight-line and the CSV
  // was restored. If CPA later mandates EIR, that is a production change
  // (2A cron + JP4 + JP5), not a fixture edit.
  it('CSV golden case — straight-line allocation matches fixture (#1333)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Pay 4 installments
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });

    for (let i = 0; i < 4; i++) {
      await accrual.execute(insts[i].id);
      await postPriorReceipt(journal, c.id, insts[i]);
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

  it('shop-collect (2026-07-08): deposit leg lands on 11-2107, metadata stamped, and the generic settlement clears it', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const tmpl = new RepossessionJP5Template(journal, prisma as any);
    // Caller (repossessions.service) substitutes depositAccountCode='11-2107'
    // when collectedByShop — mirror that contract here.
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-2107',
      repossessionValue: new Decimal('7000.00'),
      collectedByShop: true,
    });

    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['flow'], equals: 'repossession' } } as any,
      include: { lines: true },
    });
    expect(entries.length, 'expected exactly 1 repossession JE').toBe(1);

    // Deposit leg parked as shop receivable — NOT a cash account.
    const shopLeg = entries[0].lines.find((l) => l.accountCode === '11-2107');
    expect(shopLeg, 'Dr 11-2107 leg should exist').toBeDefined();
    expect(new Decimal(shopLeg!.debit.toString()).toFixed(2)).toBe('7000.00');

    // Metadata pairs the JE with its later settlement (same convention as JP4).
    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.collectedByShop).toBe(true);
    expect(meta.shopReceivable).toBe('11-2107');
    expect(meta.contractId).toBe(c.id);

    // The generic settlement (sums 11-2107 by metadata.contractId) must find
    // and clear the JP5-originated receivable — Dr KBank / Cr 11-2107.
    const settlement = new ShopCollectSettlementTemplate(journal, prisma as any);
    await settlement.execute({
      contractId: c.id,
      depositAccountCode: '11-1201',
      amount: new Decimal('7000.00'),
    });

    const lines = await prisma.journalLine.findMany({
      where: {
        accountCode: '11-2107',
        journalEntry: {
          AND: [
            { metadata: { path: ['contractId'], equals: c.id } } as any,
            { status: 'POSTED' },
            { deletedAt: null },
          ],
        },
      },
      select: { debit: true, credit: true },
    });
    const outstanding = lines.reduce(
      (s, l) => s.plus(new Decimal(l.debit.toString())).minus(new Decimal(l.credit.toString())),
      new Decimal(0),
    );
    expect(outstanding.toFixed(2), '11-2107 fully cleared after settlement').toBe('0.00');

    // Second settlement on the same contract must be rejected (nothing left).
    await expect(
      settlement.execute({
        contractId: c.id,
        depositAccountCode: '11-1201',
        amount: new Decimal('1.00'),
      }),
    ).rejects.toThrow(/ไม่มียอด 11-2107/);
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
