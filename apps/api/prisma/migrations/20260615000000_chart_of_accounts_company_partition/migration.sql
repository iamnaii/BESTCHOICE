-- Phase A.1a: ChartOfAccount multi-entity partition
ALTER TABLE "chart_of_accounts" ADD COLUMN "company_id" TEXT;

ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "company_info"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "chart_of_accounts" SET "company_id" = (
  SELECT id FROM "company_info" WHERE "company_code" = 'SHOP' LIMIT 1
) WHERE 'SHOP' = ANY("allowed_companies") AND "company_id" IS NULL;

UPDATE "chart_of_accounts" SET "company_id" = (
  SELECT id FROM "company_info" WHERE "company_code" = 'FINANCE' LIMIT 1
) WHERE 'FINANCE' = ANY("allowed_companies") AND "company_id" IS NULL;

ALTER TABLE "chart_of_accounts" DROP CONSTRAINT IF EXISTS "chart_of_accounts_code_key";

CREATE UNIQUE INDEX "chart_of_accounts_company_id_code_key" ON "chart_of_accounts" ("company_id", "code");
CREATE INDEX "chart_of_accounts_company_id_idx" ON "chart_of_accounts" ("company_id");

ALTER TABLE "chart_of_accounts" DROP COLUMN "allowed_companies";
