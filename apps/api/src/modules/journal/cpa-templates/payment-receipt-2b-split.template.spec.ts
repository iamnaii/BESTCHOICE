import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient, PaymentStatus } from '@prisma/client';
import path from 'path';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { loadCaseFromCsv } from '../__tests__/csv-fixture-loader';
import { diffGoldenJE } from '../__tests__/golden-je-matcher';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { PaymentReceipt2BSplitTemplate } from './payment-receipt-2b-split.template';
import { JournalAutoService } from '../journal-auto.service';
import { AccountRoleService } from '../account-role.service';

const prisma = new PrismaClient();

function makeRoles(): AccountRoleService {
  const svc = new AccountRoleService(prisma as any);
  svc.__setCacheForTests(
    new Map([
      ['adj_underpay', '52-1104'],
      ['adj_overpay', '53-1503'],
    ]),
  );
  return svc;
}

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
  const c = await seedStandard17k12m(prisma);
  const journal = new JournalAutoService(prisma as any);
  await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
  const inst = await prisma.installmentSchedule.findFirstOrThrow({
    where: { contractId: c.id, installmentNo: 1 },
  });
  await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(inst.id);
  return { contract: c, inst, journal };
}

async function get2BPartialBlocks(contractId: string) {
  const entries = await prisma.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: contractId } } as any,
        { metadata: { path: ['tag'], equals: '2B' } } as any,
      ],
    },
    include: { lines: true },
    orderBy: { createdAt: 'asc' },
  });
  return entries.map((e) => ({
    tag: '2B',
    lines: e.lines.map((l) => ({
      code: l.accountCode,
      dr: new Decimal(l.debit.toString()),
      cr: new Decimal(l.credit.toString()),
    })),
  }));
}

describe('PaymentReceipt2BSplitTemplate', () => {
  it('case 3 — split 800 + 715.83 generates two 2B JEs', async () => {
    const { contract, inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BSplitTemplate(journal, prisma as any, makeRoles());

    await tmpl.executePartial({
      installmentScheduleId: inst.id,
      partialAmount: new Decimal('800.00'),
      depositAccountCode: '11-1101',
      isFinalPartial: false,
    });

    await tmpl.executePartial({
      installmentScheduleId: inst.id,
      partialAmount: new Decimal('715.83'),
      depositAccountCode: '11-1101',
      isFinalPartial: true,
    });

    const expected = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-3-split-payment.csv'),
    );
    // CSV may emit two 2B blocks (2B1, 2B2) or one 2B with sub-blocks. Filter what's there.
    const expected2B = expected.entries.filter(
      (e) => e.tag === '2B' || e.tag === '2B1' || e.tag === '2B2',
    );
    const actual = await get2BPartialBlocks(contract.id);

    expect(actual.length).toBe(2);
    // Diff each block individually (account codes + amounts), tag-agnostic since CSV may use 2B1/2B2 vs 2B
    for (let i = 0; i < expected2B.length && i < actual.length; i++) {
      const exp = { ...expected2B[i], tag: '2B' };
      const act = actual[i];
      const diff = diffGoldenJE([exp], [act]);
      expect(diff.diffs, `block ${i}: ` + diff.diffs.join('\n')).toEqual([]);
    }
  });

  it('D1.1.6.1 — final-partial underpay routes via AccountRoleService (adj_underpay)', async () => {
    const { contract, inst, journal } = await setup();
    const customRoles = new AccountRoleService(prisma as any);
    customRoles.__setCacheForTests(
      new Map([
        ['adj_underpay', '52-9999'],
        ['adj_overpay', '53-1503'],
      ]),
    );
    await prisma.chartOfAccount.upsert({
      where: { code: '52-9999' },
      update: {},
      create: {
        code: '52-9999',
        name: 'ส่วนลด — fixture override (D1.1.6.1)',
        type: 'ค่าใช้จ่าย',
        normalBalance: 'Dr',
      },
    });

    const tmpl = new PaymentReceipt2BSplitTemplate(journal, prisma as any, customRoles);
    // First non-final partial: 800
    await tmpl.executePartial({
      installmentScheduleId: inst.id,
      partialAmount: new Decimal('800.00'),
      depositAccountCode: '11-1101',
      isFinalPartial: false,
    });
    // Final partial 715.00 → diff of -0.83 (underpay within 1฿ tolerance)
    await tmpl.executePartial({
      installmentScheduleId: inst.id,
      partialAmount: new Decimal('715.00'),
      depositAccountCode: '11-1101',
      isFinalPartial: true,
      toleranceApproverId: 'test-approver-id',
    });

    const blocks = await get2BPartialBlocks(contract.id);
    const finalBlock = blocks[blocks.length - 1];
    const codes = finalBlock.lines.map((l) => l.code);
    expect(codes).toContain('52-9999');
    expect(codes).not.toContain('52-1104');
  });

  it('rejects final partial that exceeds tolerance', async () => {
    const { inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BSplitTemplate(journal, prisma as any, makeRoles());
    await tmpl.executePartial({
      installmentScheduleId: inst.id,
      partialAmount: new Decimal('500.00'),
      depositAccountCode: '11-1101',
      isFinalPartial: false,
    });
    await expect(
      tmpl.executePartial({
        installmentScheduleId: inst.id,
        partialAmount: new Decimal('800.00'), // total 1300, short by 215.83
        depositAccountCode: '11-1101',
        isFinalPartial: true,
      }),
    ).rejects.toThrow(/exceeds tolerance/i);
  });
});
