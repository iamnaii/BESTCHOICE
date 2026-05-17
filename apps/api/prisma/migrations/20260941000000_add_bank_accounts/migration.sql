-- SP6 — Bank/Cash Account directory page (/finance/bank-accounts).
--
-- Why a separate table when `chart_of_accounts` already holds 11-1101..1203?
--   The CoA stores the accounting code/name only. This table adds operational
--   metadata that does NOT belong in the chart: bank brand, account number
--   (PII), account type, currency, custodian notes, soft-delete. The UI
--   computes current balance from `journal_lines` by `account_code`.
--
-- Seeded rows mirror the 6 default cash/bank codes from `.claude/rules/accounting.md`
-- (the project's source of truth for account names). Bank account numbers are
-- extracted from the CoA CSV and stored in the dedicated `account_number` column
-- so the digits aren't lost when we shorten the display name. `ON CONFLICT DO
-- NOTHING` keeps the seed idempotent — manual UPDATE is preferred over re-seed
-- if prod operators later edit names.

-- Required for gen_random_uuid() in the seed below.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "bank_accounts" (
  "id"             TEXT PRIMARY KEY,
  "account_code"   TEXT NOT NULL,
  "account_name"   TEXT NOT NULL,
  "bank_name"      TEXT NOT NULL,
  "account_number" TEXT,
  "account_type"   TEXT NOT NULL DEFAULT 'SAVINGS',
  "currency"       TEXT NOT NULL DEFAULT 'THB',
  "is_active"      BOOLEAN NOT NULL DEFAULT true,
  "notes"          TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  "deleted_at"     TIMESTAMP(3)
);

-- Partial unique on account_code: only active (non-soft-deleted) rows enforce
-- uniqueness. Allows recreating an account after a soft-delete without
-- conflicting with the historical row. Pattern mirrors
-- `chat_messages_external_message_id_key` (PR add_unified_chat_engine).
CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_account_code_active_key"
  ON "bank_accounts" ("account_code")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "bank_accounts_account_code_idx" ON "bank_accounts" ("account_code");
CREATE INDEX IF NOT EXISTS "bank_accounts_deleted_at_idx"    ON "bank_accounts" ("deleted_at");

-- Seed 6 default cash + bank accounts. Names match accounting.md (project rule)
-- — bank account numbers from the CoA CSV are stored separately in account_number.
-- The seed is idempotent: re-running the migration is a no-op because the
-- partial unique index above blocks duplicate account_codes for active rows.
INSERT INTO "bank_accounts" ("id", "account_code", "account_name", "bank_name", "account_number", "account_type", "is_active", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, '11-1101', 'เงินสด — สุทธินีย์ คงเดช',     'เงินสดในมือ',  NULL,            'CASH',    true, NOW(), NOW()),
  (gen_random_uuid()::text, '11-1102', 'เงินสด — เอกนรินทร์ อาคะนาริน', 'เงินสดในมือ',  NULL,            'CASH',    true, NOW(), NOW()),
  (gen_random_uuid()::text, '11-1103', 'เงินสด — พนักงานบัญชี',         'เงินสดในมือ',  NULL,            'CASH',    true, NOW(), NOW()),
  (gen_random_uuid()::text, '11-1201', 'ธนาคาร KBank',                   'กสิกรไทย',     '203-1-16520-5', 'SAVINGS', true, NOW(), NOW()),
  (gen_random_uuid()::text, '11-1202', 'ธนาคาร SCB (ค่าใช้จ่าย)',         'ไทยพาณิชย์',   '579-4-13208-8', 'SAVINGS', true, NOW(), NOW()),
  (gen_random_uuid()::text, '11-1203', 'ธนาคาร SCB (ค่าเสื่อม)',          'ไทยพาณิชย์',   '579-4-13209-6', 'SAVINGS', true, NOW(), NOW())
ON CONFLICT DO NOTHING;
