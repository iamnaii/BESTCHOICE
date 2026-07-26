import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { BadDebtProvisionTemplate } from './bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from './bad-debt-writeoff.template';
import { PaymentReceiptTemplate } from './payment-receipt.template';
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
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
  await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
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

    // I3 — metadata.idempotencyKey backs the DB-level partial unique index
    // (journal_entries_idempotency_idx) on (flow, idempotencyKey).
    expect((je!.metadata as any).idempotencyKey).toBe(contractId);
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

    // Should have Dr 51-1102 (remainder). c2 only ran 1A (no 2A accrual) — this
    // is the all-deferred case: loss before consume = 18,190.00 (Dr 11-2106
    // 6,000 + Dr 21-2102 1,190 vs Cr 11-2101 17,000 + Cr 11-2105 1,190 +
    // Cr 21-2101 1,190 + Cr 41-1101 6,000), minus 1,000 provision consumed.
    const expenseLine = je!.lines.find((l) => l.accountCode === '51-1102');
    expect(expenseLine).toBeDefined();
    expect(new Decimal(expenseLine!.debit.toString()).toFixed(2)).toBe('17190.00');
  });

  it('mixed accrued/deferred: issues CN VAT + clears 11-2103/11-2106/VAT legs (golden 17k, 3 accrued)', async () => {
    const c3 = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c3.id);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c3.id },
      orderBy: { installmentNo: 'asc' },
      take: 3,
    });
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    for (const inst of insts) await accrual.execute(inst.id);

    const result = await new BadDebtWriteOffTemplate(journal, prisma as any).execute({
      contractId: c3.id,
    });
    expect(result.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: c3.id } } as any,
        ],
      },
      include: { lines: true },
    });
    const get = (code: string, side: 'debit' | 'credit') => {
      const l = je!.lines.find(
        (x) => x.accountCode === code && new Decimal(x[side].toString()).gt(0),
      );
      return l ? new Decimal(l[side].toString()).toFixed(2) : null;
    };
    // NOTE on 892.49 (not 892.51): verified directly against the fixture's own
    // inputs — vatTotal=1190.00 / 12 months, ROUND_HALF_UP → vatPerInst=99.17,
    // ×3 accrued installments = 297.51 consumed from the 1190.00 deferred-VAT
    // balance → remainder = 1190.00 − 297.51 = 892.49 (confirmed via
    // @prisma/client/runtime/library Decimal, not just manual arithmetic).
    // This affects the 21-2102/11-2105/21-2101 balancing leg and the 51-1102
    // plug (17,892.49, not 17,892.51) — a $0.02 slip in the task brief's
    // hand-worked example that does not match the fixture's own numbers.
    expect(get('21-2101', 'debit')).toBe('297.51'); // CN ม.82/5
    expect(get('11-2103', 'credit')).toBe('4547.49');
    expect(get('11-2101', 'credit')).toBe('12750.02');
    expect(get('11-2106', 'debit')).toBe('4500.00');
    expect(get('21-2102', 'debit')).toBe('892.49');
    expect(get('11-2105', 'credit')).toBe('892.49');
    expect(get('21-2101', 'credit')).toBe('892.49'); // deferred VAT ถึงกำหนด
    expect(get('41-1101', 'credit')).toBe('4500.00');
    expect(get('51-1102', 'debit')).toBe('17892.49'); // loss plug

    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    expect((je!.metadata as any).creditNoteIssued).toBe(true);
    expect((je!.metadata as any).creditNoteVatAmount).toBe('297.51');
  });

  it('all-deferred (no 2A run): no CN line, clears 1A balances only', async () => {
    const c4 = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c4.id);
    await new BadDebtWriteOffTemplate(journal, prisma as any).execute({ contractId: c4.id });

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: c4.id } } as any,
        ],
      },
      include: { lines: true },
    });
    // ไม่มี Dr 21-2101 (ไม่มีงวด accrued → ไม่มี CN)
    const cnLine = je!.lines.find(
      (l) => l.accountCode === '21-2101' && new Decimal(l.debit.toString()).gt(0),
    );
    expect(cnLine).toBeUndefined();
    expect((je!.metadata as any).creditNoteIssued).toBe(false);
    // Cr 11-2101 = 17,000 เต็ม, Dr 11-2106 = 6,000, loss plug = 18,190 − 6,000 − 1,190 ... :
    // Dr: 11-2106 6,000 + 21-2102 1,190 → Cr: 11-2101 17,000 + 11-2105 1,190 + 21-2101 1,190 + 41-1101 6,000
    // → Dr 51-1102 = 25,380 − 7,190 = 18,190.00
    const loss = je!.lines.find((l) => l.accountCode === '51-1102');
    expect(new Decimal(loss!.debit.toString()).toFixed(2)).toBe('18190.00');
  });

  /**
   * CN pro-rate (CPA ruling 2026-07-26, docs/superpowers/plans/2026-07-26-cn-prorate-cpa.md).
   *
   * Same 3-accrued / 9-deferred split as the "mixed" golden above, but
   * installment #1 gets a REAL partial receipt — Dr 11-1101 1,000 / Cr 11-2103
   * 1,000 posted via PaymentReceiptTemplate (not just a bare Payment row).
   * Unlike JP5's accruedClear11_2103 (count-based, pre-existing backlog item —
   * not touched by pro-rate), write-off's Cr legs are GL-based (`glBal` reads
   * live JE balances), so a bare Payment row with no matching GL movement would
   * silently produce the WRONG Cr 11-2103 for this template. Posting the real
   * receipt JE is the only faithful way to exercise the GL-based leg.
   *
   * Per-installment CN VAT (computeCnBreakdown, ROUND_HALF_UP 2dp):
   *   #1 (partial): outstanding = 1,515.83 − 1,000 = 515.83
   *     cnVat = 99.17 × 515.83 / 1,515.83 = 33.75
   *   #2, #3 (no Payment row → fully outstanding): cnVat = 99.17 each
   *   totalCnVat = 33.75 + 99.17 + 99.17 = 232.09  (was 297.51 in the mixed golden)
   *
   * GL 11-2103 (accrued): 3 × 1,515.83 − 1,000 (real receipt) = 3,547.49
   *   (was 4,547.49 in the mixed golden — reduced by exactly the cash received)
   *
   * Every other leg is identical to the mixed golden (same 9 deferred
   * installments, untouched by this receipt): 11-2101 Cr 12,750.02, 11-2106 Dr
   * 4,500.00, 21-2102 Dr 892.49, 11-2105 Cr 892.49, 21-2101 Cr 892.49, 41-1101
   * Cr 4,500.00.
   *
   * Loss plug (51-1102) = ΣCr − ΣDr (no prior provision on this contract):
   *   ΣDr = 232.09 (CN VAT) + 4,500.00 (11-2106) + 892.49 (21-2102) = 5,624.58
   *   ΣCr = 3,547.49 (11-2103) + 12,750.02 (11-2101) + 892.49 (11-2105)
   *         + 892.49 (21-2101) + 4,500.00 (41-1101) = 22,582.49
   *   plug = 22,582.49 − 5,624.58 = 16,957.91  (never negative here — the
   *   negative-plug guard in the template stays untripped; the plug only ever
   *   drops with real cash collected, which strictly reduces the loss)
   *   (vs. mixed golden's 17,892.49 — delta = 1,000 [less cash to clear, so
   *   less Cr] − 65.42 [less CN VAT recovered, so less Dr] = 934.58 reduction)
   */
  it('pro-rates CN VAT for a partially-paid accrued installment, Cr 11-2103 reflects the real GL reduction (CPA 2026-07-26)', async () => {
    const c5 = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c5.id);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c5.id },
      orderBy: { installmentNo: 'asc' },
      take: 3,
    });
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    for (const inst of insts) await accrual.execute(inst.id);

    // Real 2B-equivalent receipt on installment #1 — Dr 11-1101 / Cr 11-2103
    // 1,000, actually moving the GL balance (not just a Payment-row fiction).
    const receiptTpl = new PaymentReceiptTemplate(journal, prisma as any);
    await receiptTpl.execute({
      installmentScheduleId: insts[0].id,
      delta: new Decimal('1000.00'),
      debitAccountCode: '11-1101',
    });

    // Payment row — computeCnBreakdown reads amountDue/amountPaid/status from
    // here to pro-rate the CN VAT (PaymentReceiptTemplate never touches Payment).
    await prisma.payment.create({
      data: {
        contractId: c5.id,
        installmentNo: insts[0].installmentNo,
        dueDate: insts[0].dueDate,
        amountDue: new Decimal('1515.83'),
        amountPaid: new Decimal('1000.00'),
        status: 'PARTIALLY_PAID',
      },
    });

    const result = await new BadDebtWriteOffTemplate(journal, prisma as any).execute({
      contractId: c5.id,
    });
    expect(result.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'write-off' } } as any,
          { metadata: { path: ['contractId'], equals: c5.id } } as any,
        ],
      },
      include: { lines: true },
    });
    const get = (code: string, side: 'debit' | 'credit') => {
      const l = je!.lines.find(
        (x) => x.accountCode === code && new Decimal(x[side].toString()).gt(0),
      );
      return l ? new Decimal(l[side].toString()).toFixed(2) : null;
    };

    expect(get('21-2101', 'debit')).toBe('232.09'); // CN ม.82/5, pro-rated
    expect(get('11-2103', 'credit')).toBe('3547.49'); // GL-based — reflects the real 1,000 receipt
    expect(get('11-2101', 'credit')).toBe('12750.02');
    expect(get('11-2106', 'debit')).toBe('4500.00');
    expect(get('21-2102', 'debit')).toBe('892.49');
    expect(get('11-2105', 'credit')).toBe('892.49');
    expect(get('21-2101', 'credit')).toBe('892.49'); // deferred VAT ถึงกำหนด
    expect(get('41-1101', 'credit')).toBe('4500.00');
    expect(get('51-1102', 'debit')).toBe('16957.91'); // loss plug — self-adjusts

    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    expect((je!.metadata as any).creditNoteIssued).toBe(true);
    expect((je!.metadata as any).creditNoteVatAmount).toBe('232.09');
  });
});
