-- Fix NULL values in unique constraint columns (PostgreSQL treats NULL != NULL)
-- Change storage and has_warranty to NOT NULL with defaults

-- Update existing NULLs to defaults
UPDATE "pricing_templates" SET "storage" = '' WHERE "storage" IS NULL;
UPDATE "pricing_templates" SET "has_warranty" = false WHERE "has_warranty" IS NULL;

-- Drop old unique index
DROP INDEX IF EXISTS "pricing_templates_brand_model_storage_category_has_warranty_key";

-- Alter columns to NOT NULL with defaults
ALTER TABLE "pricing_templates" ALTER COLUMN "storage" SET DEFAULT '';
ALTER TABLE "pricing_templates" ALTER COLUMN "storage" SET NOT NULL;
ALTER TABLE "pricing_templates" ALTER COLUMN "has_warranty" SET DEFAULT false;
ALTER TABLE "pricing_templates" ALTER COLUMN "has_warranty" SET NOT NULL;

-- Recreate unique index (now works correctly since no NULLs)
CREATE UNIQUE INDEX "pricing_templates_brand_model_storage_category_has_warranty_key" ON "pricing_templates"("brand", "model", "storage", "category", "has_warranty");
