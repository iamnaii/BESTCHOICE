/**
 * Asset Module — orphan account verification (Bug Report v2, PDF Task #3).
 *
 * READ-ONLY: checks production journal_lines for account codes that
 * should NOT appear in Asset Module JEs per Master COA.
 *
 * Outputs JSON to stdout:
 *   - orphans: per-account line count + total amount, scoped to Asset Module flows
 *   - assetJeCount: total Asset Module JEs (context)
 *   - coaPresence: which of the suspect codes exist in chart_of_accounts
 *   - allFlows: distinct metadata.flow values across all JEs (sanity check)
 *
 * Expected result: orphans = [] (Asset module deployed 2026-05-11 with correct codes).
 *
 * Run locally:  npx tsx apps/api/scripts/verify-asset-orphans.ts
 * Run on prod:  via Cloud Run Job (ephemeral) — see runbook in
 *               docs/superpowers/specs/2026-05-13-asset-bug-report-v2-fix-design.md §5
 *
 * If orphans > 0: follow migration SQL in spec §5.B.2 — with mandatory
 * pg_dump backup, Trial Balance snapshot, and owner approval per command.
 *
 * Wrong codes checked (per BugReport_Asset_v2.pdf):
 *   12-2201, 12-2202, 12-2203, 12-2204 — Acc.Depr. group that does NOT exist in Master COA
 *   54-1701                             — old "ขาดทุนตัดบัญชี" replaced by 53-1605
 *   11-2104                             — used by ม.83/6 elsewhere, but should never appear
 *                                         in Asset JEs (Asset uses 11-4101)
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function getOrphanAccountsInAssetScope() {
  return prisma.$queryRaw<
    Array<{
      account_code: string;
      line_count: bigint;
      total_debit: Prisma.Decimal;
      total_credit: Prisma.Decimal;
    }>
  >(Prisma.sql`
    SELECT jl.account_code,
           COUNT(*)::bigint AS line_count,
           ROUND(SUM(jl.debit)::numeric, 2) AS total_debit,
           ROUND(SUM(jl.credit)::numeric, 2) AS total_credit
    FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_entry_id = je.id
    WHERE (jl.account_code IN ('12-2201','12-2202','12-2203','12-2204','54-1701')
           OR (jl.account_code = '11-2104' AND je.metadata->>'flow' LIKE 'asset-%'))
      AND je.deleted_at IS NULL
      AND jl.deleted_at IS NULL
    GROUP BY jl.account_code
    ORDER BY jl.account_code
  `);
}

async function getAssetJeCount() {
  const rows = await prisma.$queryRaw<Array<{ asset_je_count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS asset_je_count
    FROM journal_entries
    WHERE metadata->>'flow' LIKE 'asset-%' AND deleted_at IS NULL
  `);
  return rows[0]?.asset_je_count ?? 0n;
}

async function getCoaPresence() {
  return prisma.$queryRaw<Array<{ code: string; name: string }>>(Prisma.sql`
    SELECT code, name FROM chart_of_accounts
    WHERE code IN ('12-2201','12-2202','12-2203','12-2204','54-1701',
                   '11-2104','11-4101','53-1605',
                   '12-2101','12-2102','12-2103','12-2104',
                   '12-2105','12-2106','12-2107','12-2108')
    ORDER BY code
  `);
}

async function getAllFlows() {
  return prisma.$queryRaw<Array<{ flow: string; cnt: bigint }>>(Prisma.sql`
    SELECT metadata->>'flow' AS flow, COUNT(*)::bigint AS cnt
    FROM journal_entries
    WHERE metadata->>'flow' IS NOT NULL AND deleted_at IS NULL
    GROUP BY metadata->>'flow'
    ORDER BY metadata->>'flow'
  `);
}

async function main() {
  const [orphans, assetJeCount, coaPresence, allFlows] = await Promise.all([
    getOrphanAccountsInAssetScope(),
    getAssetJeCount(),
    getCoaPresence(),
    getAllFlows(),
  ]);

  const result = {
    timestamp: new Date().toISOString(),
    summary: {
      orphan_codes_found: orphans.length,
      asset_module_je_count: Number(assetJeCount),
      verdict: orphans.length === 0 ? 'CLEAN — no migration needed' : 'ORPHANS FOUND — see migration SQL in spec §5.B.2',
    },
    orphans: orphans.map((o) => ({
      account_code: o.account_code,
      line_count: Number(o.line_count),
      total_debit: o.total_debit.toString(),
      total_credit: o.total_credit.toString(),
    })),
    coa_presence: coaPresence,
    all_flows: allFlows.map((f) => ({ flow: f.flow, count: Number(f.cnt) })),
  };

  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  process.exit(orphans.length === 0 ? 0 : 2);
}

main().catch(async (e) => {
  console.error('ERROR:', e);
  await prisma.$disconnect();
  process.exit(1);
});
