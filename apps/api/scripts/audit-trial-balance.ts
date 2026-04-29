/**
 * Audit script: trial balance integrity per (company, year, month).
 *
 * Outputs JSON to stdout:
 *   - monthlyTrialBalance: per-period Σ Dr / Σ Cr / diff / balanced
 *   - draftEntriesOlderThan7d
 *   - voidedWithoutReverse (heuristic: no POSTED entry referencing original number)
 *   - orphanPayments (PaymentStatus PAID/PARTIALLY_PAID with no JE reference)
 *   - orphanPaidExpenses (ExpenseStatus PAID with no JE reference)
 *   - postedAfterClose (JE.posted_at > AccountingPeriod.closed_at)
 *
 * Run locally:  npx tsx apps/api/scripts/audit-trial-balance.ts > /tmp/audit.json
 * Run on prod:  via Cloud Run Job (ephemeral) — DO NOT commit DATABASE_URL
 *
 * READ-ONLY: SELECT queries only. Allowlist tables:
 *   journal_entries, journal_lines, payments, expenses, accounting_periods
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function getMonthlyTrialBalance() {
  const rows = await prisma.$queryRaw<
    Array<{
      company_id: string;
      year: number;
      month: number;
      sum_debit: Prisma.Decimal;
      sum_credit: Prisma.Decimal;
      entry_count: bigint;
    }>
  >(Prisma.sql`
    SELECT
      je.company_id,
      EXTRACT(YEAR FROM je.entry_date)::int AS year,
      EXTRACT(MONTH FROM je.entry_date)::int AS month,
      COALESCE(SUM(jl.debit), 0) AS sum_debit,
      COALESCE(SUM(jl.credit), 0) AS sum_credit,
      COUNT(DISTINCT je.id) AS entry_count
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.status = 'POSTED'
      AND je.deleted_at IS NULL
      AND jl.deleted_at IS NULL
    GROUP BY je.company_id, year, month
    ORDER BY je.company_id, year, month
  `);

  return rows.map((r) => {
    const diff = r.sum_debit.minus(r.sum_credit);
    return {
      companyId: r.company_id,
      year: r.year,
      month: r.month,
      sumDebit: r.sum_debit.toFixed(2),
      sumCredit: r.sum_credit.toFixed(2),
      diff: diff.toFixed(2),
      balanced: diff.isZero(),
      entryCount: Number(r.entry_count),
    };
  });
}

async function getDraftOlderThan7d() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await prisma.journalEntry.findMany({
    where: { status: 'DRAFT', deletedAt: null, createdAt: { lt: cutoff } },
    select: {
      id: true,
      entryNumber: true,
      createdAt: true,
      companyId: true,
      description: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return rows.map((r) => ({
    ...r,
    daysOld: Math.floor((Date.now() - r.createdAt.getTime()) / 86400000),
  }));
}

async function getVoidedWithoutReverse() {
  return prisma.$queryRaw<Array<{ id: string; entry_number: string; updated_at: Date }>>(
    Prisma.sql`
      SELECT je.id, je.entry_number, je.updated_at
      FROM journal_entries je
      WHERE je.status = 'VOIDED'
        AND je.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries r
          WHERE r.deleted_at IS NULL
            AND r.status = 'POSTED'
            AND (
              r.description ILIKE '%REVERSE%' || je.entry_number || '%'
              OR r.description ILIKE '%กลับรายการ%' || je.entry_number || '%'
            )
        )
      ORDER BY je.updated_at DESC
      LIMIT 200
    `,
  );
}

async function getOrphanPayments() {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      amount_paid: Prisma.Decimal;
      paid_at: Date;
      contract_id: string;
      status: string;
    }>
  >(Prisma.sql`
    SELECT p.id, p.amount_paid, p.paid_at, p.contract_id, p.status::text
    FROM payments p
    WHERE p.deleted_at IS NULL
      AND p.status IN ('PAID', 'PARTIALLY_PAID')
      AND p.paid_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.reference_type = 'PAYMENT'
          AND je.reference_id = p.id
          AND je.deleted_at IS NULL
      )
    ORDER BY p.paid_at DESC
    LIMIT 500
  `);
  return rows.map((r) => ({
    id: r.id,
    amountPaid: r.amount_paid.toFixed(2),
    paidAt: r.paid_at.toISOString(),
    contractId: r.contract_id,
    status: r.status,
  }));
}

async function getOrphanPaidExpenses() {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      payment_date: Date;
      total_amount: Prisma.Decimal;
      expense_number: string;
    }>
  >(Prisma.sql`
    SELECT e.id, e.payment_date, e.total_amount, e.expense_number
    FROM expenses e
    WHERE e.deleted_at IS NULL
      AND e.status = 'PAID'
      AND e.payment_date IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.reference_type = 'EXPENSE'
          AND je.reference_id = e.id
          AND je.deleted_at IS NULL
      )
    ORDER BY e.payment_date DESC
    LIMIT 500
  `);
  return rows.map((r) => ({
    id: r.id,
    expenseNumber: r.expense_number,
    totalAmount: r.total_amount.toFixed(2),
    paymentDate: r.payment_date.toISOString(),
  }));
}

async function getPostedAfterClose() {
  return prisma.$queryRaw<
    Array<{
      entry_id: string;
      entry_number: string;
      entry_date: Date;
      posted_at: Date;
      period_year: number;
      period_month: number;
      period_status: string;
      closed_at: Date | null;
    }>
  >(Prisma.sql`
    SELECT
      je.id AS entry_id,
      je.entry_number,
      je.entry_date,
      je.posted_at,
      ap.year AS period_year,
      ap.month AS period_month,
      ap.status::text AS period_status,
      ap.closed_at
    FROM journal_entries je
    JOIN accounting_periods ap
      ON ap.company_id = je.company_id
     AND ap.year = EXTRACT(YEAR FROM je.entry_date)::int
     AND ap.month = EXTRACT(MONTH FROM je.entry_date)::int
    WHERE je.deleted_at IS NULL
      AND ap.status IN ('CLOSED', 'SYNCED')
      AND ap.closed_at IS NOT NULL
      AND je.posted_at IS NOT NULL
      AND je.posted_at > ap.closed_at
    ORDER BY je.posted_at DESC
    LIMIT 200
  `);
}

async function main() {
  const start = Date.now();
  console.error('[audit] starting trial balance audit...');

  const [
    monthlyTrialBalance,
    draftEntriesOlderThan7d,
    voidedWithoutReverse,
    orphanPayments,
    orphanPaidExpenses,
    postedAfterClose,
  ] = await Promise.all([
    getMonthlyTrialBalance(),
    getDraftOlderThan7d(),
    getVoidedWithoutReverse(),
    getOrphanPayments(),
    getOrphanPaidExpenses(),
    getPostedAfterClose(),
  ]);

  const elapsed = Date.now() - start;
  console.error(`[audit] completed in ${elapsed}ms`);

  const output = {
    runAt: new Date().toISOString(),
    elapsedMs: elapsed,
    summary: {
      monthCount: monthlyTrialBalance.length,
      unbalancedMonthCount: monthlyTrialBalance.filter((m) => !m.balanced).length,
      draftOver7d: draftEntriesOlderThan7d.length,
      voidedWithoutReverse: voidedWithoutReverse.length,
      orphanPaymentCount: orphanPayments.length,
      orphanExpenseCount: orphanPaidExpenses.length,
      postedAfterCloseCount: postedAfterClose.length,
    },
    monthlyTrialBalance,
    draftEntriesOlderThan7d,
    voidedWithoutReverse,
    orphanPayments,
    orphanPaidExpenses,
    postedAfterClose,
  };

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((err) => {
    console.error('[audit] FATAL:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
