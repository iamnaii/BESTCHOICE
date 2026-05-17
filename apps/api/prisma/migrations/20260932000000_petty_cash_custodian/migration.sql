-- D1.1.5.5 — Petty Cash custodian assignment on CompanyInfo.
-- Adds a nullable FK to users so OWNER can mark which user is "responsible
-- for the petty-cash drawer". The eligible-role filter is enforced at the
-- service layer (SystemConfig key `petty_cash_custodian_role`, default
-- 'ACCOUNTANT'), not via a DB constraint — same pattern as filedById on
-- TaxReport.
--
-- Additive only: 1 nullable column + 1 FK + 1 lookup index. Safe on tables
-- with existing rows.

ALTER TABLE "company_info"
  ADD COLUMN "petty_cash_custodian_id" TEXT;

CREATE INDEX "company_info_petty_cash_custodian_id_idx"
  ON "company_info" ("petty_cash_custodian_id");

ALTER TABLE "company_info"
  ADD CONSTRAINT "company_info_petty_cash_custodian_id_fkey"
  FOREIGN KEY ("petty_cash_custodian_id") REFERENCES "users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
