-- SP4 — DocumentNumberConfig (OWNER-editable doc number formats per docType).
--
-- Configurable replacement for hard-coded `<TYPE>-YYYYMMDD-NNNN` convention.
-- DocNumberService.next() reads this table for prefix/format/resetCadence/digitCount
-- and falls back to legacy defaults when a row is missing (backward compat for
-- existing tests + any docType added later in code before the row is seeded).
--
-- resetCadence values: DAILY | MONTHLY | YEARLY | NEVER
-- format tokens: {prefix} {YYYY} {MM} {DD} {YYYYMMDD} {YYYYMM} {NNNN} {NN} {N}
-- The {N...} token is left-padded with zeros to `digitCount` digits.

CREATE TABLE IF NOT EXISTS "document_number_configs" (
  "id"             TEXT NOT NULL,
  "doc_type"       TEXT NOT NULL,
  "description"    TEXT NOT NULL,
  "prefix"         TEXT NOT NULL DEFAULT '',
  "format"         TEXT NOT NULL DEFAULT '{prefix}-{YYYYMMDD}-{NNNN}',
  "reset_cadence"  TEXT NOT NULL DEFAULT 'DAILY',
  "digit_count"    INTEGER NOT NULL DEFAULT 4,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "notes"          TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  "deleted_at"     TIMESTAMP(3),
  "updated_by_id"  TEXT,

  CONSTRAINT "document_number_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_number_configs_doc_type_key"
  ON "document_number_configs" ("doc_type");

CREATE INDEX IF NOT EXISTS "document_number_configs_doc_type_idx"
  ON "document_number_configs" ("doc_type");

CREATE INDEX IF NOT EXISTS "document_number_configs_deleted_at_idx"
  ON "document_number_configs" ("deleted_at");

DO $$ BEGIN
  ALTER TABLE "document_number_configs"
    ADD CONSTRAINT "document_number_configs_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Seed default configs. INSERT ... ON CONFLICT DO NOTHING for idempotency.
-- Each row mirrors the current hard-coded behavior so the refactored service
-- produces byte-identical numbers on day-one.

INSERT INTO "document_number_configs" (
  "id", "doc_type", "description", "prefix", "format",
  "reset_cadence", "digit_count", "updated_at"
) VALUES
  (gen_random_uuid()::TEXT, 'EX', 'ใบสำคัญจ่าย (Expense)',         'EX', '{prefix}-{YYYYMMDD}-{NNNN}', 'DAILY',   4, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'CN', 'ใบลดหนี้ (Credit Note)',         'CN', '{prefix}-{YYYYMMDD}-{NNNN}', 'DAILY',   4, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'PR', 'บัญชีเงินเดือน (Payroll)',       'PR', '{prefix}-{YYYYMMDD}-{NNNN}', 'DAILY',   4, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'SE', 'จ่ายชำระเจ้าหนี้ (Settlement)',  'SE', '{prefix}-{YYYYMMDD}-{NNNN}', 'DAILY',   4, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'OI', 'รายได้อื่น (Other Income)',      'OI', '{prefix}-{YYYYMMDD}-{NNNN}', 'DAILY',   4, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'RT', 'ใบเสร็จรับเงิน (Receipt)',       'RT', '{prefix}-{YYYYMM}-{NNNNN}', 'MONTHLY', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'CT', 'สัญญา (Contract)',               'CT', '{prefix}-{YYYYMMDD}-{NNNN}', 'DAILY',   4, CURRENT_TIMESTAMP)
ON CONFLICT ("doc_type") DO NOTHING;
