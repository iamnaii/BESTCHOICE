import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { loadCaseFromCsv } from '../__tests__/csv-fixture-loader';
import { diffGoldenJE } from '../__tests__/golden-je-matcher';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { JournalAutoService } from '../journal-auto.service';
import type { ActualJe } from '../__tests__/golden-je-matcher';

const prisma = new PrismaClient();

/** Helper: fetch 2A JEs for a contract via metadata JSONB query */
async function get2AJEs(contractId: string): Promise<ActualJe[]> {
  const entries = await prisma.journalEntry.findMany({
    where: {
      metadata: { path: ['contractId'], equals: contractId },
    },
    include: { lines: true },
  });
  return entries
    .filter((e) => (e.metadata as any)?.tag === '2A')
    .map((e) => ({
      tag: '2A',
      lines: e.lines.map((l) => ({
        code: l.accountCode,
        dr: new Decimal(l.debit.toString()),
        cr: new Decimal(l.credit.toString()),
      })),
    }));
}

describe('Template 2A — Installment Accrual', () => {
  beforeAll(async () => {
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
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);

    const systemEmail = 'admin@bestchoice.com';
    const existing = await prisma.user.findFirst({ where: { email: systemEmail } });
    if (!existing) {
      const anyBranch = await prisma.branch.findFirst({ where: { deletedAt: null } });
      let branchId = anyBranch?.id;
      if (!branchId) {
        const co = await prisma.companyInfo.findFirst({ where: { deletedAt: null } });
        let companyId = co?.id;
        if (!companyId) {
          const created = await prisma.companyInfo.create({
            data: {
              nameTh: 'System Co',
              taxId: '9999999999999',
              companyCode: 'SYSTEM',
              address: '1 System Rd',
              directorName: 'System',
              vatRegistered: false,
            },
          });
          companyId = created.id;
        }
        const b = await prisma.branch.create({ data: { name: '__system__', companyId } });
        branchId = b.id;
      }
      await prisma.user.create({
        data: {
          email: systemEmail,
          password: 'hashed_placeholder',
          name: 'Admin',
          role: 'OWNER',
          branchId,
        },
      });
    }
  });

  // EIR migration Phase 4: CSV regenerated to match EIR period 1 = 817.05
  // (was straight-line 500). Re-enabled.
  it('matches CSV golden case-1 block 2A for installment 1', async () => {
    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);

    // First run 1A to set up the HP receivable
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Find installment #1
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 1 },
    });

    const tmpl = new InstallmentAccrual2ATemplate(journal, prisma as any);
    await tmpl.execute(inst.id);

    // Load CSV golden — the 2A block is tagged '2A' already in the CSV
    const fixture = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-1-overpay.csv'),
    );
    const expected2A = fixture.entries.filter((e) => e.tag === '2A');
    expect(expected2A.length).toBeGreaterThan(0);

    const actual2A = await get2AJEs(c.id);

    expect(actual2A.length).toBe(1);

    const diff = diffGoldenJE(expected2A, actual2A);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
    expect(diff.ok).toBe(true);
  });

  it('is idempotent — returns null and skips on second call', async () => {
    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 1 },
    });

    const tmpl = new InstallmentAccrual2ATemplate(journal, prisma as any);

    // First call should succeed
    const r1 = await tmpl.execute(inst.id);
    expect(r1).not.toBeNull();
    expect(r1?.entryNo).toBeTruthy();

    // Second call on same installment should be a no-op
    const r2 = await tmpl.execute(inst.id);
    expect(r2).toBeNull();

    // Only 1 accrual JE for this contract
    const actual2A = await get2AJEs(c.id);
    expect(actual2A.length).toBe(1);
  });

  describe('advance auto-consume on accrual (CPA Policy A)', () => {
    it('does NOT post advance-consume JE when contract has no advance', async () => {
      const c = await seedStandard17k12m(prisma);
      const journal = new JournalAutoService(prisma as any);
      await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
      const inst = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: 1 },
      });

      const tmpl = new InstallmentAccrual2ATemplate(journal, prisma as any);
      await tmpl.execute(inst.id);

      const consumeJE = await prisma.journalEntry.findFirst({
        where: {
          metadata: { path: ['flow'], equals: 'advance-consume-on-accrual' },
        } as any,
      });
      expect(consumeJE).toBeNull();
    });

    it('full-cover: advance >= installmentTotal → consume = installmentTotal, balance decreases', async () => {
      const c = await seedStandard17k12m(prisma);
      const journal = new JournalAutoService(prisma as any);
      await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

      // Park 2,000 advance (> installmentTotal 1,515.83)
      await prisma.contract.update({
        where: { id: c.id },
        data: { advanceBalance: '2000' },
      });

      const inst = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: 1 },
      });

      const tmpl = new InstallmentAccrual2ATemplate(journal, prisma as any);
      await tmpl.execute(inst.id);

      const consumeJE = await prisma.journalEntry.findFirstOrThrow({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'advance-consume-on-accrual' } as any },
            { metadata: { path: ['contractId'], equals: c.id } as any },
          ],
        },
        include: { lines: { orderBy: { createdAt: 'asc' } } },
      });

      // Dr 21-1103 = 1515.83, Cr 11-2103 = 1515.83 (= installmentTotal)
      const dr = consumeJE.lines.find((l) => l.accountCode === '21-1103')!;
      const cr = consumeJE.lines.find((l) => l.accountCode === '11-2103')!;
      expect(dr.debit.toString()).toBe('1515.83');
      expect(cr.credit.toString()).toBe('1515.83');
      expect((consumeJE.metadata as any).consumeAmount).toBe('1515.83');

      // Contract advanceBalance reduced by consume
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      expect(after.advanceBalance.toString()).toBe('484.17'); // 2000 - 1515.83
    });

    it('partial-cover: advance < installmentTotal → consume = advance, balance hits 0', async () => {
      const c = await seedStandard17k12m(prisma);
      const journal = new JournalAutoService(prisma as any);
      await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

      // Park 500 advance (< installmentTotal 1,515.83)
      await prisma.contract.update({
        where: { id: c.id },
        data: { advanceBalance: '500' },
      });

      const inst = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: 1 },
      });

      const tmpl = new InstallmentAccrual2ATemplate(journal, prisma as any);
      await tmpl.execute(inst.id);

      const consumeJE = await prisma.journalEntry.findFirstOrThrow({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'advance-consume-on-accrual' } as any },
            { metadata: { path: ['contractId'], equals: c.id } as any },
          ],
        },
        include: { lines: true },
      });

      // Dr 21-1103 = 500, Cr 11-2103 = 500
      expect(consumeJE.lines.find((l) => l.accountCode === '21-1103')!.debit.toString()).toBe('500');
      expect(consumeJE.lines.find((l) => l.accountCode === '11-2103')!.credit.toString()).toBe('500');

      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      expect(after.advanceBalance.toString()).toBe('0');
    });

    it('flips Payment.status to PAID when advance fully covers installmentTotal', async () => {
      const c = await seedStandard17k12m(prisma);
      const journal = new JournalAutoService(prisma as any);
      await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
      await prisma.contract.update({
        where: { id: c.id },
        data: { advanceBalance: '2000' },
      });

      const inst = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: 1 },
      });

      // Pre-create a PENDING Payment row (mirrors how payments.service stages
      // an advance receipt before due date).
      await prisma.payment.create({
        data: {
          contractId: c.id,
          installmentNo: 1,
          dueDate: inst.dueDate,
          amountDue: '1515.83',
          amountPaid: '0',
          status: 'PENDING',
        },
      });

      const tmpl = new InstallmentAccrual2ATemplate(journal, prisma as any);
      await tmpl.execute(inst.id);

      const payment = await prisma.payment.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: 1 },
      });
      expect(payment.status).toBe('PAID');
      expect(payment.amountPaid.toString()).toBe('1515.83');
      expect(payment.paidDate).not.toBeNull();
    });
  });
});
