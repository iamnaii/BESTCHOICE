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

    // Per-installment amounts: 17000/12 = 1416.66 ROUND_DOWN, 1190/12 = 99.17 ROUND_HALF_UP
    // installmentTotal = 1416.66 + 99.17 = 1515.83
    // 9 deferred × 99.17 = 892.53 — this is what 21-2101 should be Cr
    const expectedDeferredVat = new Decimal('99.17').times(9); // 892.53
    const cr21_2101 = sumCr(lines, '21-2101');
    expect(cr21_2101.toFixed(2)).toBe(expectedDeferredVat.toFixed(2));
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

    // 3 accrued × installmentTotal (1515.83) = 4547.49
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

    // 21-2101 Cr = 12 × 99.17 = 1190.04
    const expectedAllDeferredVat = new Decimal('99.17').times(12);
    const cr21_2101 = sumCr(lines, '21-2101');
    expect(cr21_2101.toFixed(2)).toBe(expectedAllDeferredVat.toFixed(2));

    // 11-2101 Cr = 12 × 1416.66 = 16,999.92
    const expectedGross = new Decimal('1416.66').times(12);
    const cr11_2101 = sumCr(lines, '11-2101');
    expect(cr11_2101.toFixed(2)).toBe(expectedGross.toFixed(2));

    // 11-2106 Dr = sum of EIR interest schedule for periods 1..12
    // Phase 3 EIR allocation totals exactly to interestTotal (6000) via final-period
    // residual adjustment. Same total as straight-line 12 × 500 — only the per-period
    // distribution differs.
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
 * (Wave 1 / Task 8).
 *
 * TFRS §B61-B63 + TAS 36 — when an allowance for doubtful accounts (provision)
 * has already been recognized for a receivable, derecognition of that receivable
 * (e.g. on repossession) must consume the existing provision FIRST. Recognizing
 * the loss directly to 51-1102 without consuming 11-2102 = double-count loss
 * (once via provision expense in prior period, once via repo loss now).
 *
 * Logic:
 *   provisionBalance = sum(Cr 11-2102) - sum(Dr 11-2102)  for this contractId
 *   loss             = remainingTotal - repossessionValue
 *   consume          = min(loss, provisionBalance)
 *   if consume > 0:  Dr 11-2102 (consume)
 *   if loss - consume > 0:  Dr 51-1102 (loss - consume)
 *
 * Standard 17K/12M, no 2A run beforehand → 12 deferred installments:
 *   deferredGross = 12 × 1416.66 = 16,999.92
 *   deferredVat   = 12 × 99.17   =  1,190.04
 *   remainingTotal = 18,189.96
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

    // Repo at 5,000 — remainingTotal = 18,189.96 → loss = 13,189.96
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // Should consume the entire provision balance: Dr 11-2102 = 3,000
    const dr11_2102 = sumDr(lines, '11-2102');
    expect(dr11_2102.toFixed(2)).toBe('3000.00');

    // Remaining loss to P&L: Dr 51-1102 = 13,189.96 - 3,000 = 10,189.96
    const dr51_1102 = sumDr(lines, '51-1102');
    expect(dr51_1102.toFixed(2)).toBe('10189.96');

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

    // No 11-2102 line at all (neither Dr nor Cr)
    const dr11_2102 = sumDr(lines, '11-2102');
    const cr11_2102 = sumCr(lines, '11-2102');
    expect(dr11_2102.toFixed(2)).toBe('0.00');
    expect(cr11_2102.toFixed(2)).toBe('0.00');

    // Full loss recognized at 51-1102: 18,189.96 - 5,000 = 13,189.96
    const dr51_1102 = sumDr(lines, '51-1102');
    expect(dr51_1102.toFixed(2)).toBe('13189.96');
  });

  it('consumes provision up to loss amount only when provision exceeds loss', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Pre-seed a generous provision = 20,000 (exceeds the 13,189.96 loss)
    const provisionTmpl = new BadDebtProvisionTemplate(journal, prisma as any);
    await provisionTmpl.execute({
      contractId: c.id,
      provisionAmount: new Decimal('20000.00'),
      period: '2025-04',
    });

    // Repo at 5,000 — loss = 13,189.96 (less than provision balance)
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    // Consume only the loss amount (not the full 20,000 provision)
    const dr11_2102 = sumDr(lines, '11-2102');
    expect(dr11_2102.toFixed(2)).toBe('13189.96');

    // No 51-1102 line — provision fully covers the loss
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

    // Cr 21-2101 only from deferred (9 × 99.17 = 892.53) — accrued path no longer credits
    const expectedDeferredVat = new Decimal('99.17').times(9); // 892.53
    const cr21_2101 = sumCr(lines, '21-2101');
    expect(cr21_2101.toFixed(2)).toBe(expectedDeferredVat.toFixed(2));

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

    // Repo at 5,000 — without credit note loss = 13,189.96 (Task 8 baseline)
    // With credit note Dr 21-2101 = 297.51, loss reduces by 297.51 → 12,892.45
    const jp5 = new RepossessionJP5Template(journal, prisma as any);
    await jp5.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal('5000.00'),
    });

    const lines = await getJp5Lines(c.id);

    const dr51_1102 = sumDr(lines, '51-1102');
    expect(dr51_1102.toFixed(2)).toBe('12892.45');

    // JE balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });
});
