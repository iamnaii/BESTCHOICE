-- Owner Response Q1-Q8 sign-off (2026-05-17) — apply 4 SystemConfig defaults
-- locked in by owner. Reference: Owner_Response_Q1-Q8_BESTCHOICE_v2.0.pdf
--
-- Idempotent: ON CONFLICT (key) DO UPDATE rewrites value + label, clears
-- deletedAt (in case a previous soft-delete left the row dormant), and
-- bumps updated_at. Safe to re-run.
--
-- Q1 (CRITICAL) — Petty Cash Cr leg = 11-1103 เงินสดพนักงานบัญชี
--   (Imprest Fund pattern). Owner directive supersedes the in-code default
--   `11-1201` in apps/api/src/modules/expense-documents/services/petty-cash.service.ts.
--   A parallel commit flips that default for defense in depth so future
--   environments missing this row still get the correct account.
--
-- Q2 — Audit log retention = 1,825 days (5 years) per พ.ร.บ.การบัญชี ม.7.
--   Read by AuditRetentionCron.getRetentionDays() with OWNER-editable
--   precedence over env var + compliance default.
--
-- Q4 — VIEWER role activation flag flipped ON. Note: actual @Roles() wiring
--   for VIEWER on /accounting/*, /audit-logs, /reports/* is delivered in a
--   FOLLOW-UP PR. Flipping the flag here alone is currently a no-op for
--   permission grants — but it lets that follow-up PR ship as a pure
--   addition with no SystemConfig writes.
--
-- Q8 — Petty cash replenish alert threshold lowered 5000 -> 1000 (IN_APP
--   channel only). Owner can set 0 later to disable the alert entirely.

INSERT INTO "system_config" ("id", "key", "value", "label", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'petty_cash_account', '11-1103',
    'บัญชีเงินสดสำหรับ Petty Cash (Cr leg ของ PETTY_CASH_REIMBURSEMENT) — Imprest Fund pattern',
    NOW(), NOW()),
  (gen_random_uuid()::text, 'audit_log_retention_days', '1825',
    'จำนวนวันเก็บ Audit Log (พ.ร.บ.การบัญชี ม.7 — 5 ปี)',
    NOW(), NOW()),
  (gen_random_uuid()::text, 'viewer_role_enabled', 'true',
    'เปิดใช้งาน VIEWER role (read-only สำหรับ external auditor — CPA / สรรพากร)',
    NOW(), NOW()),
  (gen_random_uuid()::text, 'petty_cash_replenish_threshold', '1000',
    'เกณฑ์แจ้งเตือนเติมเงินสด Petty Cash (บาท; 0 = ปิด alert)',
    NOW(), NOW())
ON CONFLICT ("key") DO UPDATE
SET "value"      = EXCLUDED."value",
    "label"      = EXCLUDED."label",
    "deleted_at" = NULL,
    "updated_at" = NOW();
