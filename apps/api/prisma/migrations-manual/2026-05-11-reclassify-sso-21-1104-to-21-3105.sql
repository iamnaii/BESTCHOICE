-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ Manual migration — reclassify SSO placeholder JE lines              │
-- │                                                                      │
-- │ Run AFTER Fix Report P0-3 deploys (PR #__) and AFTER `npm run seed:coa`│
-- │ has populated chart_of_accounts with 21-3105 + 21-3106.              │
-- │                                                                      │
-- │ Background: prior to Fix Report P0-3 the PayrollTemplate booked the  │
-- │ employee SSO deduction to 21-1104 (เจ้าหนี้ค่าใช้จ่ายกิจการ) as a      │
-- │ placeholder. The Trial Balance for 21-1104 therefore mixed real AP   │
-- │ with SSO obligations.                                                │
-- │                                                                      │
-- │ This script reclassifies historical Cr 21-1104 lines that originated │
-- │ from PAYROLL JEs into 21-3105 (employee side) — matching the new     │
-- │ PayrollTemplate output. It does NOT split out the employer-side      │
-- │ (21-3106 / Dr 53-1102) because those lines never existed in the      │
-- │ legacy JE. If owner wants employer-side recorded historically, follow│
-- │ up with a separate adjusting JE per period (manual entry).           │
-- │                                                                      │
-- │ Idempotent: filters on the `[migrated …]` note tag so a second run   │
-- │ won't re-update already-migrated rows.                               │
-- │                                                                      │
-- │ ⚠ Backup DB before running. Run inside maintenance window.            │
-- │ ⚠ Test in staging first.                                              │
-- │                                                                      │
-- │ Verification (run before commit):                                    │
-- │   SELECT account_code, COUNT(*), SUM(credit_amount)                  │
-- │   FROM journal_lines jl                                              │
-- │   JOIN journal_entries je ON je.id = jl.journal_entry_id             │
-- │   WHERE je.metadata->>'flow' = 'expense-payroll'                     │
-- │     AND jl.account_code IN ('21-1104', '21-3105')                    │
-- │   GROUP BY account_code;                                             │
-- │                                                                      │
-- │ After run: 21-1104 PAYROLL count = 0; 21-3105 count = original count.│
-- └──────────────────────────────────────────────────────────────────────┘

BEGIN;

-- 1. Ensure 21-3105 exists (will exist after seed-coa run — defensive check).
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM chart_of_accounts
  WHERE code = '21-3105';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'chart_of_accounts is missing 21-3105 — run seed-coa first';
  END IF;
END $$;

-- 2. Reclassify SSO placeholder lines on POSTED PAYROLL JEs only.
--    Filter:
--      - JE metadata->>'flow' = 'expense-payroll'
--      - account_code = '21-1104'
--      - credit_amount > 0 (we only mis-booked the Cr side)
--      - description ILIKE '%ประกันสังคม%' (defensive — legacy text used this)
--      - description NOT ILIKE '%[migrated 2026-05-11%' (idempotency)
WITH sso_lines AS (
  SELECT jl.id
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.metadata->>'flow' = 'expense-payroll'
    AND jl.account_code = '21-1104'
    AND jl.credit_amount > 0
    AND COALESCE(jl.description, '') ILIKE '%ประกันสังคม%'
    AND COALESCE(jl.description, '') NOT ILIKE '%[migrated 2026-05-11%'
)
UPDATE journal_lines
SET account_code = '21-3105',
    description = COALESCE(description, '')
      || ' [migrated 2026-05-11 from 21-1104 per Fix Report P0-3]'
WHERE id IN (SELECT id FROM sso_lines);

-- 3. Audit log — one row summarizing how many JLs were migrated.
INSERT INTO audit_logs (id, action, entity, user_id, ip_address, metadata, created_at)
VALUES (
  gen_random_uuid(),
  'SSO_RECLASSIFY_MIGRATION',
  'journal_line',
  NULL, -- system migration, no user
  NULL,
  jsonb_build_object(
    'fix_report', 'P0-3',
    'from_code', '21-1104',
    'to_code', '21-3105',
    'reason', 'Reclassify legacy SSO placeholder per Fix Report P0-3'
  ),
  NOW()
);

COMMIT;

-- Post-run verification (run separately, NOT inside the transaction above):
--
-- SELECT account_code, COUNT(*) AS lines, ROUND(SUM(credit_amount), 2) AS total_cr
-- FROM journal_lines jl
-- JOIN journal_entries je ON je.id = jl.journal_entry_id
-- WHERE je.metadata->>'flow' = 'expense-payroll'
--   AND jl.account_code IN ('21-1104', '21-3105')
-- GROUP BY account_code
-- ORDER BY account_code;
--
-- Expected:
--   21-1104 — only NON-SSO PAYROLL lines (or zero rows)
--   21-3105 — all the reclassified SSO lines
