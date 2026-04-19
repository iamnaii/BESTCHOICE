-- T5-C21: Require fromCompanyId/toCompanyId on inter_company_transactions.
-- Previously nullable (ON DELETE SET NULL) which silently lost the entity FK
-- whenever CompanyInfo lookup failed at tx create time. This migration:
--   1. Seeds stub SHOP/FINANCE CompanyInfo rows if missing (idempotent)
--   2. Backfills any NULL fromCompanyId/toCompanyId rows by resolving
--      fromEntity/toEntity strings against the seeded stubs
--   3. Alters columns to NOT NULL
--   4. Tightens FK from SET NULL -> RESTRICT (accidental company delete must
--      refuse instead of silently severing the link)
--
-- Safe on fresh DBs (stub INSERT is conditional) and on existing DBs where
-- seed.ts already created canonical rows (ON CONFLICT DO NOTHING).

-- 1. Seed stub SHOP company if missing
INSERT INTO "company_info" (
  "id", "name_th", "name_en", "tax_id", "company_code", "address",
  "director_name", "vat_registered", "is_active", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  'BESTCHOICE SHOP (stub)',
  'BESTCHOICE Shop',
  '0000000000000',
  'SHOP',
  'stub address — replace via seed',
  'stub director',
  false,
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "company_info" WHERE "company_code" = 'SHOP' AND "deleted_at" IS NULL
);

-- 2. Seed stub FINANCE company if missing
INSERT INTO "company_info" (
  "id", "name_th", "name_en", "tax_id", "company_code", "address",
  "director_name", "vat_registered", "vat_rate", "is_active", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  'BESTCHOICE FINANCE (stub)',
  'BESTCHOICE Finance',
  '0000000000001',
  'FINANCE',
  'stub address — replace via seed',
  'stub director',
  true,
  0.07,
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "company_info" WHERE "company_code" = 'FINANCE' AND "deleted_at" IS NULL
);

-- 3. Backfill NULL FKs from fromEntity/toEntity strings
UPDATE "inter_company_transactions" ict
SET "from_company_id" = ci.id
FROM "company_info" ci
WHERE ict."from_company_id" IS NULL
  AND ci."deleted_at" IS NULL
  AND (
    (ict."from_entity" ILIKE '%FINANCE%' AND ci."company_code" = 'FINANCE') OR
    (ict."from_entity" ILIKE '%SHOP%'    AND ci."company_code" = 'SHOP')
  );

UPDATE "inter_company_transactions" ict
SET "to_company_id" = ci.id
FROM "company_info" ci
WHERE ict."to_company_id" IS NULL
  AND ci."deleted_at" IS NULL
  AND (
    (ict."to_entity" ILIKE '%FINANCE%' AND ci."company_code" = 'FINANCE') OR
    (ict."to_entity" ILIKE '%SHOP%'    AND ci."company_code" = 'SHOP')
  );

-- 4. Fallback: any rows still NULL get pointed at the SHOP stub so the
-- NOT NULL step cannot fail. These rows will be flagged by a data-audit
-- report afterwards for manual cleanup, but the DB integrity stays intact.
UPDATE "inter_company_transactions"
SET "from_company_id" = (SELECT id FROM "company_info" WHERE "company_code" = 'SHOP' AND "deleted_at" IS NULL LIMIT 1)
WHERE "from_company_id" IS NULL;

UPDATE "inter_company_transactions"
SET "to_company_id" = (SELECT id FROM "company_info" WHERE "company_code" = 'SHOP' AND "deleted_at" IS NULL LIMIT 1)
WHERE "to_company_id" IS NULL;

-- 5. NOT NULL + tighter FK
ALTER TABLE "inter_company_transactions" ALTER COLUMN "from_company_id" SET NOT NULL;
ALTER TABLE "inter_company_transactions" ALTER COLUMN "to_company_id" SET NOT NULL;

ALTER TABLE "inter_company_transactions" DROP CONSTRAINT "inter_company_transactions_from_company_id_fkey";
ALTER TABLE "inter_company_transactions" DROP CONSTRAINT "inter_company_transactions_to_company_id_fkey";

ALTER TABLE "inter_company_transactions"
  ADD CONSTRAINT "inter_company_transactions_from_company_id_fkey"
  FOREIGN KEY ("from_company_id") REFERENCES "company_info"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inter_company_transactions"
  ADD CONSTRAINT "inter_company_transactions_to_company_id_fkey"
  FOREIGN KEY ("to_company_id") REFERENCES "company_info"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
