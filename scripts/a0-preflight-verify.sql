-- A0 · Pre-flight Verify — Production DB Verification Queries
-- ============================================================
-- Source: docs/superpowers/tracking/_owner-package/Dev_Action_Items_v1.0.md
--         Actions #1 (page 3), #3 (page 12), #5 (page 19)
-- Tracking: docs/superpowers/tracking/A0-preflight-verify.md
--
-- These are READ-ONLY queries. They do NOT modify data.
-- Schema names have been corrected from the source doc to match the
-- actual live Prisma schema (audit_log → audit_logs, asset_register → fixed_assets,
-- cr_amount/dr_amount → credit/debit, line_note → description, etc.).
--
-- Usage:
--   psql "$PROD_DATABASE_URL" -f scripts/a0-preflight-verify.sql
--
-- Then paste the output back into the A0 tracking row (Evidence/Notes column).

\echo
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║ A0.1 — Verify account_role_map (adj_underpay → 52-1104)             ║'
\echo '╠══════════════════════════════════════════════════════════════════════╣'
\echo '║ Expected:                                                             ║'
\echo '║   adj_overpay  | 53-1503 | priority=1 | is_active=t                  ║'
\echo '║   adj_underpay | 52-1104 | priority=1 | is_active=t                  ║'
\echo '║ If adj_underpay row shows 53-1503 → run Dev Action #1 Step 2 UPDATE  ║'
\echo '║   then Step 3 to find affected JEs + Step 4 to create reversing JEs. ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'

SELECT role, account_code, priority, is_active
FROM account_role_map
WHERE role IN ('adj_overpay', 'adj_underpay')
ORDER BY role, priority;

\echo
\echo '— A0.1 follow-up: JEs that may have used the WRONG (53-1503) account on underpay'
\echo '— Expected: 0 rows. > 0 rows → reverse-and-reclassify per Action #1 Step 4.'

SELECT
  je.id            AS journal_entry_id,
  je.posted_at,
  ed.number        AS doc_no,
  ea.side          AS adj_side,
  ea.amount,
  ea.account_code,
  ea.note
FROM expense_adjustments ea
JOIN expense_documents ed ON ed.id = ea.document_id
JOIN journal_entries  je ON je.metadata->>'documentId' = ed.id::text
WHERE ea.account_code = '53-1503'
  AND ea.side         = 'CR'
  AND je.posted_at   >= '2026-05-11'
ORDER BY je.posted_at DESC;

\echo
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║ A0.2 — SSO rows leftover in 21-1104 (should be 21-3105 post-PR#810) ║'
\echo '╠══════════════════════════════════════════════════════════════════════╣'
\echo '║ Expected: 0 rows.                                                    ║'
\echo '║ If > 0  → run Dev Action #3 Section 3.3 cleanup migration            ║'
\echo '║          (reclassifies remaining_sso rows from 21-1104 → 21-3105).   ║'
\echo '║ Then re-run this query — expect 0 again.                             ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'

SELECT
  je.id,
  je.posted_at,
  je.metadata->>'flow' AS flow,
  jl.account_code,
  jl.credit            AS cr_amount,
  jl.description
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE je.metadata->>'flow' = 'expense-payroll'
  AND jl.account_code      = '21-1104'
  AND jl.credit            > 0
  AND (
       jl.description ILIKE '%SSO%'
    OR jl.description ILIKE '%ประกันสังคม%'
  )
  AND jl.description NOT ILIKE '%[migrated%'
ORDER BY je.posted_at DESC;

\echo
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║ A0.3 — Depreciation JEs for งวด มี.ค.–เม.ย. 2569                    ║'
\echo '╠══════════════════════════════════════════════════════════════════════╣'
\echo '║ Expected: 2 period rows (2026-03 + 2026-04), each with count > 0    ║'
\echo '║ If empty or count=0 → cron missed those periods.                     ║'
\echo '║   Option A: POST /depreciation/run with period=YYYY-MM (per period). ║'
\echo '║   Option B: Manual adjusting JE (Dr 53-16XX / Cr 12-22XX).          ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'

SELECT
  date_trunc('month', je.posted_at) AS period,
  COUNT(*)                          AS depreciation_count,
  SUM(jl.debit)                     AS total_depreciation
FROM journal_entries je
JOIN journal_lines  jl ON jl.journal_entry_id = je.id
WHERE je.metadata->>'flow' = 'depreciation'
  AND jl.account_code     LIKE '53-16%'
  AND jl.debit            > 0
  AND je.posted_at       >= '2026-03-01'
  AND je.posted_at       <  '2026-05-01'
GROUP BY 1
ORDER BY 1;

\echo
\echo '— A0.3 context: Active fixed assets eligible for depreciation'
\echo '— Schema authoritative source: apps/api/prisma/schema.prisma model FixedAsset.'
\echo '— monthly_depr is persisted on the asset row (computed at POST). accumulated_depr'
\echo '— shows how much has been booked historically. NBV = purchase_cost − accumulated_depr.'

SELECT
  asset_code,
  name,
  category,
  purchase_date::date,
  purchase_cost,
  residual_value,
  useful_life_months,
  monthly_depr,
  accumulated_depr,
  net_book_value
FROM fixed_assets
WHERE status         = 'POSTED'
  AND deleted_at    IS NULL
  AND disposal_date IS NULL
ORDER BY asset_code;

\echo
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║ A0 — DONE                                                            ║'
\echo '║ Copy the output above into A0 tracking Evidence/Notes column.        ║'
\echo '║ If any check fails: STOP — do not start B1/C2 until remediated.     ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'
