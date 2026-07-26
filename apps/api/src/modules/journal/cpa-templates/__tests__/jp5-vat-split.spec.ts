import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../installment-accrual-2a.template';
import { RepossessionJP5Template } from '../repossession-jp5.template';
import { BadDebtProvisionTemplate } from '../bad-debt-provision.template';
import { JournalAutoService } from '../../journal-auto.service';

/**
 * JP5 VAT split — accrued vs deferred installments (Wave 1 / Task 7).
 *
 * Background: ป.รัษฎากร ม.82/3 + ประกาศ 36/2536 ข้อ 3 — VAT แต่ละงวดเกิด
 * ความรับผิดเพียง 1 ครั้ง ห้ามนำส่งซ้ำ.
 *
 * Before this fix: JP5 unconditionally Cr 21-2101 for every unpaid installment.
 * For installments where 2A had already run (2A debits 21-2102, credits 21-2101),
 * JP5's additional Cr 21-2101 caused double-credit → ภ.พ.30 over-reported.
 *
 * After this fix: JP5 inspects InstallmentSchedule.accrualJournalEntryId per
 * installment and splits the JE into:
 *   - Accrued path (2A already ran): Dr 11-2103 only — clears the receivable
 *     parked there by 2A. No 21-2101 / 11-2105 / 11-2106 movement (those
 *     already settled by 2A).
 *   - Deferred path (2A not run): full original logic — Dr 21-2102 + 11-2106,
 *     Cr 11-2101 + 11-2105 + 21-2101 + 41-1101.
 */

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
  // NOT wiped: badDebtWriteOffAuditLog is immutable (DB trigger, T1-C7) —
  // deleteMany({}) throws once any row exists (see cn-issue-on-writeoff.spec.ts).
  await prisma.promiseSlot.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.dunningAction.deleteMany({});
  await prisma.repossession.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.payment.deleteMany({});
  // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
  // contract written off via the real writeOffBadDebt() has a permanent
  // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
  const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
  await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
  await seedFinanceCoa(prisma);

  const exists = await prisma.user.findUnique({ where: { email: 'admin@bestchoice.com' } });
  if (!exists) {
    await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }

  return new JournalAutoService(prisma as any);
}

interface JeLineRow {
  accountCode: string;
  debit: Decimal;
  credit: Decimal;
}

async function getJp5Lines(contractId: string): Promise<JeLineRow[]> {
  const entries = await prisma.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: contractId } } as any,
        { metadata: { path: ['flow'], equals: 'repossession' } } as any,
      ],
    },
    include: { lines: true },
  });
  expect(entries.length, 'expected exactly 1 repossession JE').toBe(1);
  return entries[0].lines.map((l) => ({
    accountCode: l.accountCode,
    debit: new Decimal(l.debit.toString()),
    credit: new Decimal(l.credit.toString()),
  }));
}

function sumDr(lines: JeLineRow[], code: string): Decimal {
  return lines
    .filter((l) => l.accountCode === code)
    .reduce((s, l) => s.plus(l.debit), new Decimal(0));
}

function sumCr(lines: JeLineRow[], code: string): Decimal {
  return lines
    .filter((l) => l.accountCode === code)
    .reduce((s, l) => s.plus(l.credit), new Decimal(0));
}

describe('JP5 VAT split — accrued vs deferred (P0 Wave 1 Task 7)', () => {
  beforeAll(async () => {
    await setup();
  });

  it('does NOT double-credit 21-2101 for already-accrued installments', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Run 2A for installments 1-3 — these get accrualJournalEntryId set
    // (no 2B / payment after, so they remain unpaid but accrued)
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });
    for (let i = 0; i < 3; i++) {
      await accrual.execute(insts[i].id);
    }

    // Repossess at month 4 — 12 unpaid installments total:
    //   3 accrued (insts 1-3, accrualJournalEntryId set, no payment)
    //   9 deferred (insts 4-12, accrualJournalEntryId null)
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // GL-based (2026-07-26, Task 5): Cr 21-2101 (deferred-due) = GL balance of
    // 21-2102 (cr side) — NOT vatPerInst × deferredCount. 21-2102 started at
    // vatTotal (1,190.00, 1A) and 2A debited it by vatPerInst per accrued
    // installment (3 × 99.17 = 297.51): 1,190.00 − 297.51 = 892.49.
    // (The naive 9 × 99.17 = 892.53 count-based figure over-counts by 0.04 —
    // the leftover satang from 12 × 99.17 = 1,190.04 overshooting the 1,190.00
    // nominal total, which only the LAST installment's 2A residual sweep
    // would absorb — that installment hasn't accrued yet in this scenario.)
    const cr21_2101 = sumCr(lines, '21-2101');
    expect(cr21_2101.toFixed(2)).toBe('892.49');
  });

  it('clears 11-2103 for accrued installments only (Dr 11-2103 = 3 × installmentTotal)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });
    for (let i = 0; i < 3; i++) {
      await accrual.execute(insts[i].id);
    }

    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // GL-based (2026-07-26, Task 5): Cr 11-2103 = GL balance of 11-2103 (dr
    // side) for this contract — here it coincides with the naive
    // 3 × installmentTotal (1,515.83) = 4,547.49 because no 2B receipt has
    // touched 11-2103 in this scenario (no partial payments). See the
    // "GL-based legs" describe block below for a scenario where a REAL
    // partial receipt makes this diverge from the count-based figure.
    const expectedClear11_2103 = new Decimal('1515.83').times(3); // 4547.49
    // Note: line is Cr 11-2103 (offsetting the Dr 11-2103 from 2A)
    const cr11_2103 = sumCr(lines, '11-2103');
    expect(cr11_2103.toFixed(2)).toBe(expectedClear11_2103.toFixed(2));
  });

  it('processes deferred installments via 11-2101/11-2105/11-2106 path when no 2A run', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // No 2A run beforehand — all 12 unpaid installments are deferred
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('7000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // No 11-2103 movement at all (no accruals to clear)
    const dr11_2103 = sumDr(lines, '11-2103');
    const cr11_2103 = sumCr(lines, '11-2103');
    expect(dr11_2103.toFixed(2)).toBe('0.00');
    expect(cr11_2103.toFixed(2)).toBe('0.00');

    // GL-based (2026-07-26, Task 5): Cr 21-2101 = GL balance of 21-2102 (cr
    // side). No 2A ever ran, so 21-2102 still holds its full 1A balance
    // (vatTotal = 1,190.00) EXACTLY — not the count-based 12 × 99.17 =
    // 1,190.04, which overshoots the contract's actual nominal VAT total by
    // the accumulated ROUND_HALF_UP residual across 12 installments.
    const cr21_2101 = sumCr(lines, '21-2101');
    expect(cr21_2101.toFixed(2)).toBe('1190.00');

    // GL-based: Cr 11-2101 = GL balance of 11-2101 (dr side) = the full 1A
    // Dr (grossExclVat = 17,000.00) untouched — not 12 × 1416.66 = 16,999.92
    // (the count-based figure loses 0.08 to the same ROUND_DOWN residual).
    const cr11_2101 = sumCr(lines, '11-2101');
    expect(cr11_2101.toFixed(2)).toBe('17000.00');

    // 11-2106 Dr = GL balance of 11-2106 (cr side) = interestTotal (6,000.00)
    // — unaffected here because 6,000/12 = 500.00 divides evenly (no residual).
    const dr11_2106 = sumDr(lines, '11-2106');
    expect(dr11_2106.toFixed(2)).toBe('6000.00');
  });

  it('JE is balanced (Dr = Cr) in mixed accrued + deferred scenario', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });
    // 5 accrued, 7 deferred
    for (let i = 0; i < 5; i++) {
      await accrual.execute(insts[i].id);
    }

    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('6000.00'),
    });

    const lines = await getJp5Lines(c.id);
    const totalDr = lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    expect(totalDr.gt(0)).toBe(true);
  });
});

/**
 * JP5 consume Bad Debt provision (11-2102) before recognizing 51-1102 loss
 * (Wave 1 / Task 8; re-derived GL-based 2026-07-26 / Task 5).
 *
 * TFRS §B61-B63 + TAS 36 — when an allowance for doubtful accounts (provision)
 * has already been recognized for a receivable, derecognition of that receivable
 * (e.g. on repossession) must consume the existing provision FIRST. Recognizing
 * the loss directly to 51-1102 without consuming 11-2102 = double-count loss
 * (once via provision expense in prior period, once via repo loss now).
 *
 * Logic (Task 5 — GL-based, adds release residual):
 *   provisionBalance = GL balance of 11-2102 for this contractId
 *   loss             = ΣCr(GL clearing legs) − ΣDr(GL clearing legs + cash)
 *   consume          = min(loss, provisionBalance)         → Dr 11-2102 (when loss > 0)
 *   release          = provisionBalance − consume          → Dr 11-2102 / Cr 51-1103 (when > 0)
 *   remainingLoss    = loss − consume                      → Dr 51-1102 (when > 0)
 *
 * Standard 17K/12M, no 2A run beforehand → 12 deferred installments, no
 * receipts posted. GL invariant (Task 5): bal(11-2103)+bal(11-2101)+bal(21-2102,cr)
 * is conserved by 2A (each accrual moves value between the three accounts
 * without changing the sum) — with ZERO installments accrued and ZERO receipts
 * posted, the sum is simply the 1A grand total: grossExclVat (17,000.00) +
 * vatTotal (1,190.00) = 18,190.00 EXACTLY (no count-based rounding drift).
 *   loss = 18,190.00 − repossessionValue(5,000) = 13,190.00
 */
describe('JP5 consume Bad Debt provision before loss (Task 8)', () => {
  beforeAll(async () => {
    await setup();
  });

  it('consumes 11-2102 balance before recognizing 51-1102 loss', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Pre-seed provision = 3,000 (e.g. monthly close ran before)
    const provisionTmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    await provisionTmpl.execute({
      contractId: c.id,
      provisionAmount: new Decimal('3000.00'),
      period: '2025-04',
    });

    // Repo at 5,000 — GL-based remainingTotal = 18,190.00 → loss = 13,190.00
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // Consumes the entire provision balance (3,000 < loss) — no release since
    // provision is fully used up. Dr 11-2102 = 3,000 (consume only).
    const dr11_2102 = sumDr(lines, '11-2102');
    expect(dr11_2102.toFixed(2)).toBe('3000.00');
    // No release line when provision <= loss.
    const cr51_1103 = sumCr(lines, '51-1103');
    expect(cr51_1103.toFixed(2)).toBe('0.00');

    // Remaining loss to P&L: Dr 51-1102 = 13,190.00 - 3,000 = 10,190.00
    const dr51_1102 = sumDr(lines, '51-1102');
    expect(dr51_1102.toFixed(2)).toBe('10190.00');

    // JE remains balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });

  it('skips 11-2102 entirely when no prior provision exists', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // No provision — repo straight away
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // No 11-2102 line at all (neither Dr nor Cr) — provisionBalance = 0, so
    // both consume and release are 0.
    const dr11_2102 = sumDr(lines, '11-2102');
    const cr11_2102 = sumCr(lines, '11-2102');
    expect(dr11_2102.toFixed(2)).toBe('0.00');
    expect(cr11_2102.toFixed(2)).toBe('0.00');

    // Full loss recognized at 51-1102: 18,190.00 - 5,000 = 13,190.00
    const dr51_1102 = sumDr(lines, '51-1102');
    expect(dr51_1102.toFixed(2)).toBe('13190.00');
  });

  it('provision > loss releases the excess (Dr 11-2102 / Cr 51-1103) — 11-2102 lands on exactly 0 (Task 5)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Pre-seed a generous provision = 20,000 (exceeds the 13,190.00 loss)
    const provisionTmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    await provisionTmpl.execute({
      contractId: c.id,
      provisionAmount: new Decimal('20000.00'),
      period: '2025-04',
    });

    // Repo at 5,000 — loss = 13,190.00 (less than provision balance)
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // consume(13,190.00) + release(20,000 − 13,190.00 = 6,810.00) — BOTH post
    // as Dr 11-2102, summing to the FULL provision balance (Task 5).
    const dr11_2102 = sumDr(lines, '11-2102');
    expect(dr11_2102.toFixed(2)).toBe('20000.00');

    // Release residual recognized at 51-1103 (reversal of the allowance).
    const cr51_1103 = sumCr(lines, '51-1103');
    expect(cr51_1103.toFixed(2)).toBe('6810.00');

    // No 51-1102 line — provision fully covers the loss via consume alone.
    const dr51_1102 = sumDr(lines, '51-1102');
    expect(dr51_1102.toFixed(2)).toBe('0.00');

    // JE balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });
});

/**
 * JP5 Credit Note for accrued VAT (Wave 2 / Task 2).
 *
 * Background: ป.รัษฎากร ม.82/5 + ประกาศ 36/2536 ข้อ 2(6) — ตอนยึดเครื่อง
 * ส่วน VAT ที่นำส่งไปแล้ว (settled at 21-2101 by 2A) ต้องออกใบลดหนี้
 * (credit note) ภายใน 30 วัน → Dr 21-2101 reduces VAT liability.
 *
 * Income recognition: ลูกค้าใช้สินค้าจริงในช่วง accrued → 41-1101 ไม่ reverse
 * (ส่วนที่ uncollectable handled via bad debt loss in 51-1102).
 *
 * Pattern:
 *   - accrued installments: Dr 21-2101 = vatPerInst × accruedCount (credit note)
 *     Net effect on JE balance: 51-1102 loss reduces by exactly accruedVat
 *     (VAT recovered via credit note is NOT a loss).
 *   - deferred installments: no credit note (VAT was never settled)
 *
 * JE metadata: creditNoteIssued + creditNoteVatAmount tracking.
 */
describe('JP5 Credit Note for accrued VAT (Wave 2 Task 2)', () => {
  beforeAll(async () => {
    await setup();
  });

  it('issues credit note (Dr 21-2101) for accrued installments per ม.82/5', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Run 2A for installments 1-3 — VAT moved to 21-2101 settled
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });
    for (let i = 0; i < 3; i++) {
      await accrual.execute(insts[i].id);
    }

    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // Credit Note: Dr 21-2101 = 3 × vatPerInst (99.17) = 297.51
    const expectedCreditNoteVat = new Decimal('99.17').times(3); // 297.51
    const dr21_2101 = sumDr(lines, '21-2101');
    expect(dr21_2101.toFixed(2)).toBe(expectedCreditNoteVat.toFixed(2));

    // Cr 21-2101 (deferred-due) = GL balance of 21-2102 (cr side), 2026-07-26
    // Task 5: 1,190.00 (1A) − 3 × 99.17 (2A) = 892.49 — NOT the count-based
    // 9 × 99.17 = 892.53 (see "does NOT double-credit" test above for the
    // full derivation of this 0.04 delta).
    const cr21_2101 = sumCr(lines, '21-2101');
    expect(cr21_2101.toFixed(2)).toBe('892.49');

    // JE metadata: credit note issued
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: c.id } } as any,
          { metadata: { path: ['flow'], equals: 'repossession' } } as any,
        ],
      },
    });
    expect(entries.length).toBe(1);
    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.creditNoteIssued).toBe(true);
    expect(meta.creditNoteVatAmount).toBe('297.51');

    // JE balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });

  it('does NOT issue credit note when all installments are deferred (no settled VAT to reverse)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // No 2A run — all 12 installments are deferred
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // No Dr 21-2101 line (no credit note)
    const dr21_2101 = sumDr(lines, '21-2101');
    expect(dr21_2101.toFixed(2)).toBe('0.00');

    // JE metadata: credit note NOT issued
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: c.id } } as any,
          { metadata: { path: ['flow'], equals: 'repossession' } } as any,
        ],
      },
    });
    expect(entries.length).toBe(1);
    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.creditNoteIssued).toBe(false);
    expect(meta.creditNoteVatAmount).toBe('0.00');
  });

  it('reduces 51-1102 loss by exactly the accrued VAT amount (credit note recovery)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Run 2A for installments 1-3
    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });
    for (let i = 0; i < 3; i++) {
      await accrual.execute(insts[i].id);
    }

    // Repo at 5,000 — GL-based remainingTotal = 18,190.00 (Task 5 invariant:
    // no receipts posted, so bal(11-2103)+bal(11-2101)+bal(21-2102,cr) always
    // equals the 1A grand total regardless of the accrued/deferred split) −
    // CN VAT 297.51 = 17,892.49. loss = 17,892.49 − 5,000 = 12,892.49.
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    const dr51_1102 = sumDr(lines, '51-1102');
    expect(dr51_1102.toFixed(2)).toBe('12892.49');

    // JE balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });

  /**
   * CN pro-rate (CPA ruling 2026-07-26, docs/superpowers/plans/2026-07-26-cn-prorate-cpa.md).
   *
   * 3 accrued installments, one PARTIALLY_PAID (amountPaid=1,000 of the
   * 1,515.83 installmentTotal). computeCnBreakdown pro-rates that installment's
   * CN VAT to its outstanding balance instead of the full vatPerInst:
   *
   *   installment #1 (partial): outstanding = 1,515.83 − 1,000 = 515.83
   *     cnVat = 99.17 × 515.83 / 1,515.83 (ROUND_HALF_UP, 2dp) = 33.75
   *   installment #2 (no Payment row → fully outstanding): cnVat = 99.17
   *   installment #3 (no Payment row → fully outstanding): cnVat = 99.17
   *   totalCnVat = 33.75 + 99.17 + 99.17 = 232.09
   *
   * Cr 11-2103 (2026-07-26, Task 5 — GL-based) reads the actual GL balance.
   * This test deliberately sets up ONLY the Payment row (not a real 2B JE —
   * see the comment at the `payment.create` call below), so 11-2103's GL
   * balance is genuinely untouched by the "partial payment" and stays at
   * 3 × 1,515.83 = 4,547.49 — same number as the count-based formula would
   * give, but for a different reason (no real GL movement happened, not
   * "count-based math coincidentally matches"). The "GL-based legs" describe
   * block below has a companion test that posts a REAL partial 2B receipt and
   * proves Cr 11-2103 diverges from this count-based figure in that case.
   *
   * remainingTotal (Task 5 GL invariant — no receipts posted, so
   * bal(11-2103)+bal(11-2101)+bal(21-2102,cr) = 1A grand total always) =
   * 18,190.00 − CN(232.09) = 17,957.91.
   * loss = remainingTotal − repossessionValue(5,000) = 12,957.91
   * (vs. the all-full-installment golden above: 12,892.49 — the delta of
   * 65.42 is exactly 297.51 − 232.09, the CN VAT no longer recovered because
   * installment #1 is partially paid.)
   */
  it('pro-rates CN VAT for a partially-paid accrued installment (CPA 2026-07-26)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });
    // Accrue installments 1-3 (same as the other mixed scenarios above)
    for (let i = 0; i < 3; i++) {
      await accrual.execute(insts[i].id);
    }

    // Installment #1 (accrued) has a partial payment — 1,000 of 1,515.83 paid.
    // Set up the Payment row state only (per task brief) — its own 2B GL effect
    // on 11-2103 is not needed for this JE-line assertion.
    await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: insts[0].installmentNo,
        dueDate: insts[0].dueDate,
        amountDue: new Decimal('1515.83'),
        amountPaid: new Decimal('1000.00'),
        status: 'PARTIALLY_PAID',
      },
    });

    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // Dr 21-2101 (credit note VAT) pro-rated: 33.75 + 99.17 + 99.17 = 232.09
    const dr21_2101 = sumDr(lines, '21-2101');
    expect(dr21_2101.toFixed(2)).toBe('232.09');

    // Clearing leg is GL-based (Task 5) — untouched here because only the
    // Payment row was set up (no real 2B JE), so GL 11-2103 is still the full
    // 3 × 1,515.83 = 4,547.49 (see companion GL-based test below for the case
    // where a REAL partial receipt makes this diverge).
    const cr11_2103 = sumCr(lines, '11-2103');
    expect(cr11_2103.toFixed(2)).toBe('4547.49');

    // Loss shifts by exactly the CN VAT delta (297.51 − 232.09 = 65.42)
    const dr51_1102 = sumDr(lines, '51-1102');
    expect(dr51_1102.toFixed(2)).toBe('12957.91');

    // JE metadata reflects the pro-rated amount
    const entries = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: c.id } } as any,
          { metadata: { path: ['flow'], equals: 'repossession' } } as any,
        ],
      },
    });
    expect(entries.length).toBe(1);
    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.creditNoteIssued).toBe(true);
    expect(meta.creditNoteVatAmount).toBe('232.09');

    // JE balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });
});

/**
 * JP5 GL-based clearing legs + release residual (2026-07-26, Task 5 —
 * ECL-per-installment plan §2.4). New scenarios not covered by the
 * count-based-era tests above:
 *
 *   (ก) a REAL partial 2B receipt against an accrued installment must reduce
 *       what JP5 clears — proves the backlog over-credit bug is closed.
 *   (ข) provision > loss → release covered by the updated "consume up to
 *       loss" test in the Task 8 describe block above (asserts release +
 *       11-2102 = 0).
 *   (ค) gain branch releases the FULL provision (consume = 0).
 */
describe('JP5 GL-based legs + release residual (Task 5 — ECL per-installment)', () => {
  beforeAll(async () => {
    await setup();
  });

  it('Cr 11-2103 = GL net after a REAL partial 2B receipt — closes the backlog over-credit (11-2103 = 0 after JP5)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });
    for (let i = 0; i < 3; i++) {
      await accrual.execute(insts[i].id);
    }

    // Real partial 2B receipt on installment #1: pays 1,000 of 1,515.83 —
    // posts an ACTUAL Dr cash / Cr 11-2103 JE (unlike the pro-rate test
    // above, which deliberately only touches the Payment row), so the GL
    // balance is genuinely reduced before JP5 runs.
    const partial = new Decimal('1000.00');
    await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo: insts[0].installmentNo,
        dueDate: insts[0].dueDate,
        amountDue: new Decimal('1515.83'),
        amountPaid: partial,
        status: 'PARTIALLY_PAID',
      },
    });
    await journal.createAndPost({
      description: `รับชำระบางส่วนงวด #${insts[0].installmentNo} — สัญญา ${c.id}`,
      reference: `${c.id}:partial-receipt-test`,
      metadata: { tag: 'receipt', contractId: c.id },
      lines: [
        { accountCode: '11-1101', dr: partial, cr: new Decimal(0), description: 'รับเงินบางส่วน' },
        {
          accountCode: '11-2103',
          dr: new Decimal(0),
          cr: partial,
          description: 'ลดลูกหนี้ค้างชำระบางส่วน',
        },
      ],
    });

    // GL 11-2103 before JP5: 3 × 1,515.83 (accrued) − 1,000 (partial) = 3,547.49
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // Cr 11-2103 = GL NET (3,547.49), NOT the naive count-based 4,547.49 —
    // this is the backlog fix: a partial receipt already reduced the GL, and
    // JP5 must clear the REMAINING balance, not re-derive from installment count.
    const cr11_2103 = sumCr(lines, '11-2103');
    expect(cr11_2103.toFixed(2)).toBe('3547.49');

    // Proves the backlog is fully closed: GL 11-2103 for this contract is
    // exactly 0 after JP5 (no residual over-credit left dangling forever).
    const finalLines = await prisma.journalLine.findMany({
      where: {
        accountCode: '11-2103',
        journalEntry: {
          metadata: { path: ['contractId'], equals: c.id },
          status: 'POSTED',
          deletedAt: null,
        },
      },
      select: { debit: true, credit: true },
    });
    const netBal = finalLines.reduce(
      (s, l) => s.plus(new Decimal(l.debit.toString())).minus(new Decimal(l.credit.toString())),
      new Decimal(0),
    );
    expect(netBal.toFixed(2)).toBe('0.00');
  });

  it('gain branch releases the FULL provision balance (consume = 0)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const provisionTmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    await provisionTmpl.execute({
      contractId: c.id,
      provisionAmount: new Decimal('2000.00'),
      period: '2025-04',
    });

    // No accrual — all 12 deferred. GL invariant (no receipts posted):
    // remainingTotal = grand total 18,190.00. repossessionValue 20,000 >>
    // 18,190.00 → gain path.
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('20000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // consume = 0 (no loss to consume against) — release = the full 2,000.
    const dr11_2102 = sumDr(lines, '11-2102');
    expect(dr11_2102.toFixed(2)).toBe('2000.00');

    const cr51_1103 = sumCr(lines, '51-1103');
    expect(cr51_1103.toFixed(2)).toBe('2000.00');

    // Gain still recognized independently at 41-1102: 20,000 − 18,190.00 = 1,810.00
    const cr41_1102 = sumCr(lines, '41-1102');
    expect(cr41_1102.toFixed(2)).toBe('1810.00');

    // No loss line in the gain path.
    const dr51_1102 = sumDr(lines, '51-1102');
    expect(dr51_1102.toFixed(2)).toBe('0.00');

    // JE balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });
});
