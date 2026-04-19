-- Phase 2: PII column-level encryption — additive schema migration
-- Adds nullable encrypted + hash columns to Customer and TradeIn.
-- All columns are NULL initially; Phase 3 dual-write + backfill populates them.
-- Phase 6 drops the legacy plaintext columns.
-- No existing columns are modified. No DROP statements.

-- AlterTable: customers — add encrypted + hash columns
ALTER TABLE "customers"
  ADD COLUMN "national_id_encrypted"          TEXT,
  ADD COLUMN "national_id_hash"               TEXT,
  ADD COLUMN "phone_encrypted"                TEXT,
  ADD COLUMN "phone_hash"                     TEXT,
  ADD COLUMN "phone_secondary_encrypted"      TEXT,
  ADD COLUMN "email_encrypted"                TEXT,
  ADD COLUMN "address_id_card_encrypted"      TEXT,
  ADD COLUMN "address_current_encrypted"      TEXT,
  ADD COLUMN "address_work_encrypted"         TEXT,
  ADD COLUMN "guardian_national_id_encrypted" TEXT,
  ADD COLUMN "guardian_phone_encrypted"       TEXT,
  ADD COLUMN "guardian_address_encrypted"     TEXT,
  ADD COLUMN "references_encrypted"           JSONB;

-- CreateIndex: national_id_hash UNIQUE (mirrors nationalId uniqueness for encrypted lookup)
CREATE UNIQUE INDEX "customers_national_id_hash_key" ON "customers"("national_id_hash");

-- CreateIndex: phone_hash (non-unique — customers may share a household phone)
CREATE INDEX "customers_phone_hash_idx" ON "customers"("phone_hash");

-- AlterTable: trade_ins — add encrypted columns for bank transfer PII
ALTER TABLE "trade_ins"
  ADD COLUMN "transfer_account_number_encrypted" TEXT,
  ADD COLUMN "transfer_account_name_encrypted"   TEXT;
