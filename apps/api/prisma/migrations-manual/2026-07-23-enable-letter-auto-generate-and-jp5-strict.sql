-- ECL Excel v3 alignment (Phase 2) — enforcement configs
--
-- Manual (NOT auto-applied) migration. Run via psql AFTER the owner has
-- confirmed the legal review sign-off referenced below.
--
-- ============================================================================
-- !! OPERATOR CONFIRMATION REQUIRED !!
-- ============================================================================
-- This file MUST be executed with `psql` so the `\prompt` directive runs.
-- Running it with anything else (DBeaver "execute file", pgAdmin, copy-paste
-- into a generic SQL client) will likely SKIP the confirmation gate and
-- silently execute the enforcement flip — which is exactly what the gate
-- prevents.
--
-- Correct invocation:
--   psql "$DATABASE_URL" -f apps/api/prisma/migrations-manual/2026-07-23-enable-letter-auto-generate-and-jp5-strict.sql
--
-- Operator will be prompted to type `YES_ENABLE_ENFORCEMENT`. Anything else
-- aborts.
-- ============================================================================
--
-- Background:
--   Owner approved (2026-07-24): legal review passed on the auto-generated
--   collections letters (RETURN_DEVICE_45D / CONTRACT_TERMINATION_60D). Two
--   SystemConfig flags flip from "off" to enforced, plus a third fix folded
--   into the same gated run (C1, final-review pass, same owner sign-off
--   date — no separate confirmation needed, it rides the same transaction):
--
--     1. letter_auto_generate_enabled = 'true'
--        Turns on the daily cron that auto-generates collections letters.
--        Was seeded 'false' pending legal review — review is now done.
--
--     2. jp5_require_terminated_status = 'true'
--        JP5 (repossession) strict mode: a contract must have gone through
--        the CONTRACT_TERMINATION_60D letter (status = TERMINATED) before a
--        repossession can be recorded. Legal basis: ปพพ. มาตรา 386 — เจ้าหนี้
--        ต้องบอกเลิกสัญญาก่อนจึงจะใช้สิทธิยึดทรัพย์คืนได้ New key (does not
--        exist yet in any environment that predates this migration).
--
--     3. bad_debt_provision_rates → canonical CPA ECL v3.0 JSON
--        {"1-30":0.02,"31-60":0.15,"61-90":0.50,"91-180":0.75,"180+":1.00}.
--        C1 fix: a stale prod row (old bucket keys or pre-v3 rate values)
--        must NOT silently outrank the ECL v3 code defaults — the value is
--        overwritten UNCONDITIONALLY (existing row or not), same idempotent
--        insert-if-missing / update-if-present shape as key 2 above.
--
-- The seed file (`collections-foundation.seed.ts`) was updated in the same
-- change to seed BOTH keys as 'true' going forward — but its upsert only
-- touches `label` on the UPDATE branch (by design, so seeding never clobbers
-- an operator's runtime value). That means any environment that already has
-- a `letter_auto_generate_enabled` row will NOT get flipped by re-seeding.
-- This SQL is the deliberate, audited way to flip existing environments.
--
-- USAGE (single transaction so the file can be re-run safely):
--   psql "$DATABASE_URL" -f apps/api/prisma/migrations-manual/2026-07-23-enable-letter-auto-generate-and-jp5-strict.sql
--
-- After running:
--   1. Verify with the SELECT at the bottom of this file.
--   2. Confirm with the OWNER that both flags read 'true' AND that
--      bad_debt_provision_rates reads the canonical v3 JSON (C1 fix).

\set ON_ERROR_STOP on

\echo '----------------------------------------------------------------------'
\echo 'ECL Excel v3 Phase 2 — enforcement flag flip — about to inspect current state.'
\echo '----------------------------------------------------------------------'
\echo 'Current rows (if any):'

SELECT key, value, label, deleted_at IS NOT NULL AS soft_deleted
FROM system_config
WHERE key IN (
    'letter_auto_generate_enabled',
    'jp5_require_terminated_status',
    'bad_debt_provision_rates'
)
ORDER BY key;

\echo ''
\echo 'This will set the first two keys above to value = ''true'' (legal review'
\echo 'passed, owner approval 2026-07-24), and overwrite bad_debt_provision_rates'
\echo 'to the canonical CPA ECL v3.0 JSON (C1 fix, same owner sign-off). Abort'
\echo 'here if that is not intended.'
\echo ''

-- Operator confirmation prompt. Skips the enforcement flip unless the
-- operator types `YES_ENABLE_ENFORCEMENT` exactly (case-sensitive). Any
-- other string, empty input, or running via a client that ignores \prompt
-- → abort.
\prompt 'Type YES_ENABLE_ENFORCEMENT to proceed (anything else aborts): ' CONFIRMATION

-- Materialize the comparison into a psql boolean variable via \gset.
-- We can't use raw "\if :'CONFIRMATION' = 'YES_ENABLE_ENFORCEMENT'" because
-- psql's \if does NOT evaluate SQL-like comparison expressions.
SELECT (:'CONFIRMATION' = 'YES_ENABLE_ENFORCEMENT') AS proceed \gset

\if :proceed
  \echo 'Confirmed — running enforcement flip...'
\else
  \echo '!! ABORTED — confirmation string did not match YES_ENABLE_ENFORCEMENT.'
  \echo '!! Nothing was written. Re-run to retry.'
  \q
\endif

-- ============================================================================
-- Confirmed — enforcement flip below
-- ============================================================================

-- Ensure gen_random_uuid() is available. pgcrypto is enabled on GCP Cloud SQL
-- by default; this CREATE is idempotent and protects fresh local databases.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- Step 1: letter_auto_generate_enabled → true (existing key, update in place).
-- Also refresh the label to record the legal-review sign-off, matching the
-- seed file's new label text.
UPDATE system_config
SET value = 'true',
    label = 'เปิดใช้งาน cron สร้างหนังสืออัตโนมัติรายวัน (ผ่านการตรวจสอบทางกฎหมาย — owner 2026-07-24)',
    updated_at = NOW()
WHERE key = 'letter_auto_generate_enabled'
  AND deleted_at IS NULL;

-- Step 2: jp5_require_terminated_status → true. New key — insert if missing,
-- otherwise (e.g. re-run, or a prior partial apply) just make sure it reads
-- 'true'. Idempotent either way.
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT
    gen_random_uuid(),
    'jp5_require_terminated_status',
    'true',
    'JP5 strict mode: ต้องส่งหนังสือบอกเลิกสัญญา (TERMINATED) ก่อนยึดเครื่อง (ปพพ.386 — owner 2026-07-24)',
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM system_config
    WHERE key = 'jp5_require_terminated_status' AND deleted_at IS NULL
);

UPDATE system_config
SET value = 'true',
    updated_at = NOW()
WHERE key = 'jp5_require_terminated_status'
  AND deleted_at IS NULL
  AND value <> 'true';

-- Step 3 (C1 fix, final-review pass): bad_debt_provision_rates → canonical
-- CPA ECL v3.0 JSON. Unlike step 2, this UPDATE is unconditional (no
-- `AND value <> ...` guard) — a stale prod row must be overwritten
-- regardless of its current value, not just when it happens to differ from
-- the canonical JSON by a naive string comparison (rates could match
-- byte-for-byte in a different key order and still be "different" JSON).
-- Insert-if-missing first (fresh environments never seeded this key), then
-- unconditionally update the value so an existing row's stale rates never
-- silently outrank the ECL v3 defaults.
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT
    gen_random_uuid(),
    'bad_debt_provision_rates',
    '{"1-30":0.02,"31-60":0.15,"61-90":0.50,"91-180":0.75,"180+":1.00}',
    'อัตราสำรองหนี้สงสัยจะสูญ CPA ECL v3.0 (aging-based, 6 buckets B0-B5 — owner 2026-07-24)',
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM system_config
    WHERE key = 'bad_debt_provision_rates' AND deleted_at IS NULL
);

UPDATE system_config
SET value = '{"1-30":0.02,"31-60":0.15,"61-90":0.50,"91-180":0.75,"180+":1.00}',
    updated_at = NOW()
WHERE key = 'bad_debt_provision_rates'
  AND deleted_at IS NULL;

COMMIT;

\echo 'Enforcement flip complete. Verification:'

SELECT key, value, label, updated_at
FROM system_config
WHERE key IN (
    'letter_auto_generate_enabled',
    'jp5_require_terminated_status',
    'bad_debt_provision_rates'
)
ORDER BY key;
