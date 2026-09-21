-- Do not backfill past agreements from mutable product data.
ALTER TABLE "contracts" ADD COLUMN "product_disclosure" JSONB;
ALTER TABLE "sales" ADD COLUMN "product_disclosure" JSONB;
