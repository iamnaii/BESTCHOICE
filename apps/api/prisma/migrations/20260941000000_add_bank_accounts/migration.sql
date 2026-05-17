-- SP6 — Bank/Cash Account directory page (/finance/bank-accounts).
--
-- Why a separate table when `chart_of_accounts` already holds 11-1101..1203?
--   The CoA stores the accounting code/name only. This table adds operational
--   metadata that does NOT belong in the chart: bank brand, account number
--   (PII), account type, currency, custodian notes, soft-delete. The UI
--   computes current balance from `journal_lines` by `account_code`.
--
-- Seeded rows mirror the 6 default cash/bank codes from .claude/rules/accounting.md.
-- `ON CONFLICT DO NOTHING` keeps this idempotent — if the prod chart later changes
-- the names, manual UPDATE is preferred over a re-seed.

CREATE TABLE IF NOT EXISTS "bank_accounts" (
  "id"             TEXT PRIMARY KEY,
  "account_code"   TEXT NOT NULL UNIQUE,
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

CREATE INDEX IF NOT EXISTS "bank_accounts_account_code_idx" ON "bank_accounts" ("account_code");
CREATE INDEX IF NOT EXISTS "bank_accounts_deleted_at_idx"    ON "bank_accounts" ("deleted_at");

-- Seed 6 default cash + bank accounts (idempotent via ON CONFLICT on the unique code).
INSERT INTO "bank_accounts" ("id", "account_code", "account_name", "bank_name", "account_type", "is_active", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, '11-1101', 'เงินสด — สุทธินีย์ คงเดช',     'เงินสดในมือ', 'CASH',    true, NOW(), NOW()),
  (gen_random_uuid()::text, '11-1102', 'เงินสด — เอกนรินทร์ อาคะนาริน', 'เงินสดในมือ', 'CASH',    true, NOW(), NOW()),
  (gen_random_uuid()::text, '11-1103', 'เงินสด — พนักงานบัญชี',          'เงินสดในมือ', 'CASH',    true, NOW(), NOW()),
  (gen_random_uuid()::text, '11-1201', 'KBank ธนาคารกสิกรไทย',          'KBank',       'SAVINGS', true, NOW(), NOW()),
  (gen_random_uuid()::text, '11-1202', 'SCB ค่าใช้จ่าย',                  'SCB',         'SAVINGS', true, NOW(), NOW()),
  (gen_random_uuid()::text, '11-1203', 'SCB ค่าเสื่อม',                   'SCB',         'SAVINGS', true, NOW(), NOW())
ON CONFLICT ("account_code") DO NOTHING;
