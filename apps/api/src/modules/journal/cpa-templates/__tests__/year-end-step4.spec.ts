import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../../journal-auto.service';
import { YearEndClosingTemplate } from '../year-end-closing.template';
import { AccountingClosingService } from '../../../accounting/closing.service';
import { AuditService } from '../../../audit/audit.service';

const prisma = new PrismaClient();

/**
 * Year-End Closing Step 4 — DB integration golden (C3, review W2).
 *
 * Proves against a REAL Postgres instance (not the mocked jest unit specs in
 * `apps/api/src/modules/journal/year-end-closing.template.spec.ts` /
 * `apps/api/src/modules/accounting/closing.service.spec.ts`) that:
 *   1. Step 4 posts as the 4th JE, GL-sweeping 33-1101 to EXACTLY 0.00 and
 *      crediting 32-1101 with residue + this year's net (proves the GL-based
 *      read, not a netIncome pass-through — same claim the mocked specs make,
 *      here verified against real accumulated ledger state).
 *   2. Reversal restores GL to the pre-close state (33-1101 back to the
 *      prior-year residue, 32-1101 back to 0) and a subsequent re-close
 *      succeeds (idempotency escape hatch still works with 4 JEs/batch).
 *
 * Scenario: a prior-year residue JE sits in 33-1101 (dated Dec 31 of the
 * PRECEDING year — never swept, e.g. a year closed before Step 4 existed),
 * plus a normal revenue + expense JE dated inside TEST_YEAR. All 12 monthly
 * AccountingPeriods for TEST_YEAR are pre-seeded CLOSED so the guard passes.
 */

const TEST_YEAR = 2025;
const RESIDUE_AMOUNT = new Decimal('15000.00');
const REVENUE_AMOUNT = new Decimal('100000.00');
const EXPENSE_AMOUNT = new Decimal('60000.00');
const NET_INCOME = REVENUE_AMOUNT.minus(EXPENSE_AMOUNT); // 40000.00
const SWEPT_TOTAL = RESIDUE_AMOUNT.plus(NET_INCOME); // 55000.00

// Re-close scenario (test 2): `getYearAccountActivity(year)` is date-windowed
// to [Jan 1, Dec 31] of TEST_YEAR — the reversal JEs are dated TODAY (real
// wall-clock time, per `reverseYearEndClosing`'s `postedAt: now`), so they
// fall OUTSIDE that window and can never "un-close" a year's revenue/expense
// from the windowed query's point of view. A meaningful re-close therefore
// requires a REAL correction to the ledger dated inside the year — exactly
// the intended real-world workflow (reverse because the numbers were wrong,
// post the missed/corrected entry, THEN re-close) — not a no-op replay of
// the same close. This mirrors reality: nothing to re-close if nothing changed.
const CORRECTION_REVENUE = new Decimal('10000.00');
const CORRECTION_EXPENSE = new Decimal('4000.00');
const CORRECTION_NET = CORRECTION_REVENUE.minus(CORRECTION_EXPENSE); // 6000.00
const RECLOSE_SWEPT_TOTAL = RESIDUE_AMOUNT.plus(CORRECTION_NET); // 21000.00

function build() {
  const journal = new JournalAutoService(prisma as any);
  const template = new YearEndClosingTemplate(journal, prisma as any);
  const audit = new AuditService(prisma as any);
  const service = new AccountingClosingService(prisma as any, template, journal, audit);
  return { journal, template, service };
}

/** Live GL balance (Cr-normal) for an equity account, summed across ALL POSTED lines. */
async function glBalance(accountCode: string): Promise<Decimal> {
  const lines = await prisma.journalLine.findMany({
    where: {
      accountCode,
      journalEntry: { status: 'POSTED', deletedAt: null },
      deletedAt: null,
    },
    select: { debit: true, credit: true },
  });
  return lines.reduce(
    (bal, l) => bal.plus(l.credit.toString()).minus(l.debit.toString()),
    new Decimal(0),
  );
}

async function seedScenario(journal: JournalAutoService) {
  // Prior-year residue in 33-1101 — dated Dec 31 of the year BEFORE
  // TEST_YEAR, entirely OUTSIDE this closing batch. Represents a year closed
  // before Step 4 existed (or a manual correcting JE) that never got swept
  // into 32-1101.
  const { end: prevYearEnd } = YearEndClosingTemplate.bkkYearBounds(TEST_YEAR - 1);
  await journal.createAndPost({
    description: 'Test fixture: prior-year 33-1101 residue (never swept)',
    reference: 'test:year-end-step4:residue',
    postedAt: prevYearEnd,
    metadata: { flow: 'test-fixture' },
    lines: [
      { accountCode: '11-1201', dr: RESIDUE_AMOUNT, cr: new Decimal(0) },
      { accountCode: '33-1101', dr: new Decimal(0), cr: RESIDUE_AMOUNT },
    ],
  });

  // Revenue + expense dated INSIDE TEST_YEAR — drives netIncome = 40000.00
  const midYear = new Date(Date.UTC(TEST_YEAR, 5, 15, 12, 0, 0));
  await journal.createAndPost({
    description: 'Test fixture: TEST_YEAR revenue',
    reference: 'test:year-end-step4:revenue',
    postedAt: midYear,
    metadata: { flow: 'test-fixture' },
    lines: [
      { accountCode: '11-1201', dr: REVENUE_AMOUNT, cr: new Decimal(0) },
      { accountCode: '41-1101', dr: new Decimal(0), cr: REVENUE_AMOUNT },
    ],
  });
  await journal.createAndPost({
    description: 'Test fixture: TEST_YEAR expense',
    reference: 'test:year-end-step4:expense',
    postedAt: midYear,
    metadata: { flow: 'test-fixture' },
    lines: [
      { accountCode: '51-1103', dr: EXPENSE_AMOUNT, cr: new Decimal(0) },
      { accountCode: '11-1201', dr: new Decimal(0), cr: EXPENSE_AMOUNT },
    ],
  });
}

async function seedClosedPeriods(financeCompanyId: string) {
  await prisma.accountingPeriod.deleteMany({
    where: { companyId: financeCompanyId, year: TEST_YEAR },
  });
  await prisma.accountingPeriod.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      companyId: financeCompanyId,
      year: TEST_YEAR,
      month: i + 1,
      status: 'CLOSED' as const,
    })),
  });
}

describe('Year-End Closing Step 4 — DB integration (C3, GL-based sweep 33-1101 → 32-1101)', () => {
  let financeCompanyId: string;
  let adminUserId: string;

  beforeAll(async () => {
    // Cleanup ตาม convention: journalPostAuditLog ก่อน journalLine/journalEntry
    // (FK order — matches every other cpa-templates/__tests__ spec's beforeAll).
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});

    const finance = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    financeCompanyId = finance.id;

    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
    });
    adminUserId = admin.id;

    await seedClosedPeriods(financeCompanyId);

    const { journal } = build();
    await seedScenario(journal);
  });

  afterAll(async () => {
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.accountingPeriod.deleteMany({
      where: { companyId: financeCompanyId, year: TEST_YEAR },
    });
    await prisma.$disconnect();
  });

  it('posts 4 JEs; GL 33-1101 sweeps to exactly 0.00; GL 32-1101 = residue + net; every JE balances', async () => {
    const { service } = build();
    const result = await service.postYearEndClosing(TEST_YEAR, adminUserId);

    expect(result.step1).toBeTruthy();
    expect(result.step2).toBeTruthy();
    expect(result.step3).toBeTruthy();
    expect(result.step4).toBeTruthy();
    expect(result.netIncome).toBe(NET_INCOME.toFixed(2));

    const bal33 = await glBalance('33-1101');
    const bal32 = await glBalance('32-1101');
    // GL-based proof: swept total (55000.00) = residue (15000.00, seeded
    // OUTSIDE this batch, dated last year) + this year's net (40000.00) —
    // NOT just netIncome alone. That is the entire point of Step 4 reading
    // the live ledger instead of passing `netIncome` straight through.
    expect(bal33.toFixed(2)).toBe('0.00');
    expect(bal32.toFixed(2)).toBe(SWEPT_TOTAL.toFixed(2));

    // ΣDr = ΣCr for every JE in this batch (incl. Step 4)
    const batchEntries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['batchId'], equals: result.batchId } as any },
      include: { lines: true },
    });
    expect(batchEntries).toHaveLength(4);
    for (const e of batchEntries) {
      const dr = e.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
      const cr = e.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
      expect(dr.toFixed(2)).toBe(cr.toFixed(2));
    }
  });

  it('reversal restores GL fully (33-1101 back to pre-close residue, 32-1101 back to 0) — then re-close succeeds', async () => {
    const { service, journal } = build();

    await service.reverseYearEndClosing(
      TEST_YEAR,
      adminUserId,
      'ทดสอบกลับรายการ Step 4 บน DB จริง (integration spec)',
      'OWNER',
    );

    // Reversal is a literal Dr/Cr mirror of all 4 originals, so its net
    // effect on every account is zero — GL returns to exactly what it was
    // BEFORE the batch: 33-1101 = the untouched prior-year residue,
    // 32-1101 = 0 (it had zero activity before Step 4 ever ran).
    const bal33AfterReverse = await glBalance('33-1101');
    const bal32AfterReverse = await glBalance('32-1101');
    expect(bal33AfterReverse.toFixed(2)).toBe(RESIDUE_AMOUNT.toFixed(2));
    expect(bal32AfterReverse.toFixed(2)).toBe('0.00');

    // Reversal JEs are dated TODAY (outside TEST_YEAR's window), so
    // `getYearAccountActivity(TEST_YEAR)` still sees the ORIGINAL close as
    // having zeroed 2025's revenue/expense within-year — reversing doesn't
    // "unclose" that windowed view. Post ONE realistic correcting entry pair
    // (dated inside TEST_YEAR) before re-closing — the real-world trigger for
    // ever wanting a re-close in the first place (numbers were wrong, so you
    // fix the ledger, THEN re-close with the corrected figures).
    const correctionDate = new Date(Date.UTC(TEST_YEAR, 10, 1, 12, 0, 0));
    await journal.createAndPost({
      description: 'Test fixture: TEST_YEAR correcting revenue (post-reversal)',
      reference: 'test:year-end-step4:correction-revenue',
      postedAt: correctionDate,
      metadata: { flow: 'test-fixture' },
      lines: [
        { accountCode: '11-1201', dr: CORRECTION_REVENUE, cr: new Decimal(0) },
        { accountCode: '41-1101', dr: new Decimal(0), cr: CORRECTION_REVENUE },
      ],
    });
    await journal.createAndPost({
      description: 'Test fixture: TEST_YEAR correcting expense (post-reversal)',
      reference: 'test:year-end-step4:correction-expense',
      postedAt: correctionDate,
      metadata: { flow: 'test-fixture' },
      lines: [
        { accountCode: '51-1103', dr: CORRECTION_EXPENSE, cr: new Decimal(0) },
        { accountCode: '11-1201', dr: new Decimal(0), cr: CORRECTION_EXPENSE },
      ],
    });

    // Re-close after reversal must succeed (idempotency escape hatch) —
    // with the corrected net (6000.00), swept ON TOP of the untouched
    // prior-year residue (15000.00) = 21000.00.
    const reClose = await service.postYearEndClosing(TEST_YEAR, adminUserId);
    expect(reClose.step4).toBeTruthy();
    expect(reClose.batchId).not.toBe('');
    expect(reClose.netIncome).toBe(CORRECTION_NET.toFixed(2));

    const bal33Final = await glBalance('33-1101');
    const bal32Final = await glBalance('32-1101');
    expect(bal33Final.toFixed(2)).toBe('0.00');
    expect(bal32Final.toFixed(2)).toBe(RECLOSE_SWEPT_TOTAL.toFixed(2));
  });
});
