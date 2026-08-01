-- Inter-Co Settlement Batch (C2) — Pre-flight Verify (spec §10)
-- ============================================================
-- Source: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §10
-- Docs:   .claude/rules/accounting.md → "Inter-Co Settlement Batch — เมนูจ่ายให้หน้าร้าน (C2, 2026-08-01)"
-- Plan:   docs/superpowers/plans/2026-07-30-interco-settlement-batch.md (Task 7)
--
-- These are READ-ONLY queries. They do NOT modify data. Run them BEFORE
-- creating the first live "รอบจ่าย" batch on an environment (prod, or any
-- environment carrying real contract history) so the size/shape of the
-- backlog is known up front instead of discovered mid-rollout.
--
-- ------------------------------------------------------------------------
-- Usage — prod (via cloud-sql-proxy, same runbook as A0/ECL dry-run):
--   1. Start cloud_sql_proxy pointed at the prod Cloud SQL instance
--      (see docs/guides/COLLECTIONS-V2-DEPLOYMENT.md "Appendix: verify
--      commands" for the exact invocation pattern used elsewhere).
--   2. psql "$PROD_DATABASE_URL" -f docs/accounting/interco-preflight-2026-08.sql
--
-- Usage — local dev (docker postgres, container `installment-postgres`,
-- db `installment_db`, user `postgres` — see docker-compose.yml):
--   docker exec -i installment-postgres psql -U postgres -d installment_db \
--     < docs/accounting/interco-preflight-2026-08.sql
--
-- Paste the output back into the PR description / owner rollout checklist.
-- ------------------------------------------------------------------------

\echo
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║ #1 — Old settlement flow leftover (inter-company-settlement)          ║'
\echo '╠══════════════════════════════════════════════════════════════════════╣'
\echo '║ Expected: 0.                                                          ║'
\echo '║ The retired per-transaction settle() flow never stamped               ║'
\echo '║ metadata.contractId, so it is invisible to the new pending-queue      ║'
\echo '║ GL lens (IntercoPendingService) by construction. If this is > 0, an   ║'
\echo '║ opening reconcile (matching old JEs to contracts by hand) MUST happen ║'
\echo '║ before trusting the pending list — otherwise the queue could look     ║'
\echo '║ "clean" while real unsettled payables from the old flow sit outside   ║'
\echo '║ its view entirely.                                                    ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'

SELECT COUNT(*) AS old_flow_je_count
FROM journal_entries
WHERE metadata->>'flow' = 'inter-company-settlement'
  AND deleted_at IS NULL;

\echo
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║ #2 — Backlog size: contracts + outstanding 21-1101/21-1102, split by  ║'
\echo '║      activation date relative to the SHOP-wiring cutover (2026-06-23) ║'
\echo '╠══════════════════════════════════════════════════════════════════════╣'
\echo '║ No pass/fail expectation — this is a SIZING query so the owner sees   ║'
\echo '║ the backlog before the first backfill round is created. "activated"  ║'
\echo '║ is derived the same way IntercoPendingService does it: MIN(posted_at) ║'
\echo '║ across the POSTED JE(s) that stamp metadata.contractId and touch      ║'
\echo '║ 21-1101/21-1102 for that contract (1A is always the first such JE).   ║'
\echo '║ Rows on/after the cutover SHOULD carry a matching SHOP-side           ║'
\echo '║ receivable (S11-3001/S11-3002) UNLESS the contract came from          ║'
\echo '║ contract-exchange (device swap), which still does not wire the SHOP   ║'
\echo '║ leg (F2) — those will still show legacy_no_shop_count > 0 above the   ║'
\echo '║ cutover date and that is EXPECTED, not a bug.                         ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'

WITH finance_lens AS (
  SELECT
    je.metadata->>'contractId' AS contract_id,
    MIN(je.posted_at)          AS activated_at,
    SUM(CASE WHEN jl.account_code = '21-1101' THEN jl.credit - jl.debit ELSE 0 END) AS financed_outstanding,
    SUM(CASE WHEN jl.account_code = '21-1102' THEN jl.credit - jl.debit ELSE 0 END) AS commission_outstanding
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_code IN ('21-1101', '21-1102')
    AND jl.deleted_at IS NULL
    AND je.status = 'POSTED'
    AND je.deleted_at IS NULL
    AND je.metadata->>'contractId' IS NOT NULL
  GROUP BY 1
  HAVING SUM(jl.credit - jl.debit) > 0
),
shop_lens AS (
  SELECT
    je.metadata->>'contractId' AS contract_id,
    SUM(CASE WHEN jl.account_code = 'S11-3001' THEN jl.debit - jl.credit ELSE 0 END) AS shop_financed,
    SUM(CASE WHEN jl.account_code = 'S11-3002' THEN jl.debit - jl.credit ELSE 0 END) AS shop_commission
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.account_code IN ('S11-3001', 'S11-3002')
    AND jl.deleted_at IS NULL
    AND je.status = 'POSTED'
    AND je.deleted_at IS NULL
    AND je.metadata->>'contractId' IS NOT NULL
  GROUP BY 1
)
SELECT
  (f.activated_at < '2026-06-23')                                       AS pre_shop_wiring_cutover,
  COUNT(*)                                                              AS contract_count,
  COUNT(*) FILTER (
    WHERE COALESCE(s.shop_financed, 0) = 0 AND COALESCE(s.shop_commission, 0) = 0
  )                                                                      AS legacy_no_shop_count,
  ROUND(SUM(f.financed_outstanding)::numeric, 2)                         AS total_financed_outstanding,
  ROUND(SUM(f.commission_outstanding)::numeric, 2)                       AS total_commission_outstanding,
  ROUND(SUM(f.financed_outstanding + f.commission_outstanding)::numeric, 2) AS total_payable_outstanding
FROM finance_lens f
LEFT JOIN shop_lens s ON s.contract_id = f.contract_id
GROUP BY 1
ORDER BY 1;

\echo
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║ #3 — GL cross-check: SHOP receivable (S11-3001+S11-3002) vs FINANCE   ║'
\echo '║      payable (21-1101+21-1102)                                       ║'
\echo '╠══════════════════════════════════════════════════════════════════════╣'
\echo '║ Expected: shop_total <= finance_total ALWAYS (SHOP can never claim a  ║'
\echo '║ receivable FINANCE never recorded a payable for). shop_total <        ║'
\echo '║ finance_total is EXPECTED and not a bug on its own — the gap is the   ║'
\echo '║ pre-2026-06-23 / device-swap backlog quantified by query #2 above     ║'
\echo '║ (spec F1/F2 — pending CPA opening-balance ruling, spec §11).          ║'
\echo '║ shop_total > finance_total would be a genuine anomaly — investigate   ║'
\echo '║ before enabling the batch menu.                                       ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'

SELECT
  (
    SELECT ROUND(COALESCE(SUM(jl.debit - jl.credit), 0)::numeric, 2)
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_code IN ('S11-3001', 'S11-3002')
      AND jl.deleted_at IS NULL
      AND je.status = 'POSTED'
      AND je.deleted_at IS NULL
  ) AS shop_gl_total,
  (
    SELECT ROUND(COALESCE(SUM(jl.credit - jl.debit), 0)::numeric, 2)
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_code IN ('21-1101', '21-1102')
      AND jl.deleted_at IS NULL
      AND je.status = 'POSTED'
      AND je.deleted_at IS NULL
  ) AS finance_gl_total;

\echo
\echo 'Pre-flight complete. Paste all 3 result sets into the rollout PR / owner checklist.'
