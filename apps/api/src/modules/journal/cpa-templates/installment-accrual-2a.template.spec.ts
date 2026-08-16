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
    // NOT wiped: badDebtWriteOffAuditLog is immutable (DB trigger, T1-C7) —
    // deleteMany({}) throws once any row exists (see cn-issue-on-writeoff.spec.ts).
    await prisma.promiseSlot.deleteMany({});
    await prisma.callLog.deleteMany({});
    await prisma.dunningAction.deleteMany({});
    await prisma.repossession.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({
      select: { contractId: true },
    });
    await prisma.contract.deleteMany({
      where: { id: { notIn: woPoisoned.map((p) => p.contractId) } },
    });
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
      expect(consumeJE.lines.find((l) => l.accountCode === '21-1103')!.debit.toString()).toBe(
        '500',
      );
      expect(consumeJE.lines.find((l) => l.accountCode === '11-2103')!.credit.toString()).toBe(
        '500',
      );

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

  describe('park-at-last-installment (owner directive 2026-08-16)', () => {
    it('does NOT touch the park bucket on a non-last installment — generic advance still consumes exactly as before (regression)', async () => {
      const c = await seedStandard17k12m(prisma);
      const journal = new JournalAutoService(prisma as any);
      await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

      // Both buckets funded — installment #1 is NOT the last (totalMonths=12).
      await prisma.contract.update({
        where: { id: c.id },
        data: { advanceBalance: '500', rescheduleAdvanceBalance: '5000' },
      });

      const inst1 = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: 1 },
      });

      const tmpl = new InstallmentAccrual2ATemplate(journal, prisma as any);
      await tmpl.execute(inst1.id);

      // Generic advance-consume JE posts exactly like the existing
      // partial-cover regression test above (500 < installmentTotal 1515.83).
      const consumeJE = await prisma.journalEntry.findFirstOrThrow({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'advance-consume-on-accrual' } as any },
            { metadata: { path: ['contractId'], equals: c.id } as any },
          ],
        },
        include: { lines: true },
      });
      expect(consumeJE.lines.find((l) => l.accountCode === '21-1103')!.debit.toString()).toBe(
        '500',
      );

      // Park bucket completely untouched — no park-consume JE at all, balance unchanged.
      const parkJE = await prisma.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'reschedule-park-consume' } as any },
            { metadata: { path: ['contractId'], equals: c.id } as any },
          ],
        },
      });
      expect(parkJE).toBeNull();

      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      expect(after.advanceBalance.toString()).toBe('0'); // fully consumed by generic (unchanged behavior)
      expect(after.rescheduleAdvanceBalance.toString()).toBe('5000'); // untouched
    });

    it('consumes the park bucket ONLY at the last installment — JE Dr 21-1103 / Cr 11-2103, Payment stamped', async () => {
      const c = await seedStandard17k12m(prisma);
      const journal = new JournalAutoService(prisma as any);
      await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

      await prisma.contract.update({
        where: { id: c.id },
        data: { rescheduleAdvanceBalance: '1000' }, // no generic advance
      });

      const instLast = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: c.installmentCount },
      });

      // Pre-create a PENDING Payment row (mirrors the existing "flips PAID" test
      // above) with a large placeholder amountDue so the exact residual-adjusted
      // last-period installmentTotal doesn't need to be hardcoded here.
      await prisma.payment.create({
        data: {
          contractId: c.id,
          installmentNo: c.installmentCount,
          dueDate: instLast.dueDate,
          amountDue: '99999.99',
          amountPaid: '0',
          status: 'PENDING',
        },
      });

      const tmpl = new InstallmentAccrual2ATemplate(journal, prisma as any);
      await tmpl.execute(instLast.id);

      const parkJE = await prisma.journalEntry.findFirstOrThrow({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'reschedule-park-consume' } as any },
            { metadata: { path: ['contractId'], equals: c.id } as any },
          ],
        },
        include: { lines: true },
      });
      const dr = parkJE.lines.find((l) => l.accountCode === '21-1103')!;
      const cr = parkJE.lines.find((l) => l.accountCode === '11-2103')!;
      expect(dr.debit.toString()).toBe('1000');
      expect(cr.credit.toString()).toBe('1000');
      expect(dr.description).toBe('หักเงินพักปรับดิวเข้างวดสุดท้าย');
      expect((parkJE.metadata as any).consumeAmount).toBe('1000.00');

      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      expect(after.rescheduleAdvanceBalance.toString()).toBe('0');

      const payment = await prisma.payment.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: c.installmentCount },
      });
      expect(payment.amountPaid.toString()).toBe('1000');
      expect(payment.status).toBe('PARTIALLY_PAID'); // 1000 < placeholder amountDue 99999.99
    });

    it('caps combined generic+park consume at installmentTotal — leftover park stays parked for JP4/close to sweep', async () => {
      const c = await seedStandard17k12m(prisma);
      const journal = new JournalAutoService(prisma as any);
      await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

      // Fund BOTH buckets generously so their sum exceeds the last installment's
      // (residual-adjusted) installmentTotal — proves the cap.
      await prisma.contract.update({
        where: { id: c.id },
        data: { advanceBalance: '1000', rescheduleAdvanceBalance: '1000' },
      });

      const instLast = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: c.installmentCount },
      });

      const tmpl = new InstallmentAccrual2ATemplate(journal, prisma as any);
      await tmpl.execute(instLast.id);

      // Read the ACTUAL residual-adjusted installmentTotal off the 2A accrual
      // JE itself (Dr 11-2103) — avoids hardcoding the last-period rounding
      // residual math here (kept in ONE place: the template).
      const accrualJE = await prisma.journalEntry.findFirstOrThrow({
        where: {
          AND: [
            { metadata: { path: ['tag'], equals: '2A' } as any },
            { metadata: { path: ['contractId'], equals: c.id } as any },
          ],
        },
        include: { lines: true },
      });
      const installmentTotal = new Decimal(
        accrualJE.lines.find((l) => l.accountCode === '11-2103')!.debit.toString(),
      );

      const genericConsumeJE = await prisma.journalEntry.findFirstOrThrow({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'advance-consume-on-accrual' } as any },
            { metadata: { path: ['contractId'], equals: c.id } as any },
          ],
        },
        include: { lines: true },
      });
      const genericConsumed = new Decimal(
        genericConsumeJE.lines.find((l) => l.accountCode === '21-1103')!.debit.toString(),
      );
      expect(genericConsumed.toString()).toBe('1000'); // generic fully covered (1000 < installmentTotal)

      const parkJE = await prisma.journalEntry.findFirstOrThrow({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'reschedule-park-consume' } as any },
            { metadata: { path: ['contractId'], equals: c.id } as any },
          ],
        },
        include: { lines: true },
      });
      const parkConsumed = new Decimal(
        parkJE.lines.find((l) => l.accountCode === '21-1103')!.debit.toString(),
      );
      // Capped: park only covers whatever's left after generic, never the full 1000.
      const expectedParkConsume = installmentTotal.minus(genericConsumed);
      expect(parkConsumed.toString()).toBe(expectedParkConsume.toString());
      expect(parkConsumed.lt('1000')).toBe(true);

      const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
      expect(after.advanceBalance.toString()).toBe('0');
      // Leftover stays parked — NOT swept here (JP4/close is where the leftover
      // eventually gets credited back to the customer — see compute-payoff-quote.ts).
      expect(after.rescheduleAdvanceBalance.toString()).toBe(
        new Decimal('1000').minus(parkConsumed).toString(),
      );
    });
  });
});
